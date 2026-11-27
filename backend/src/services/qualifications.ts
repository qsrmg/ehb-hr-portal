import fs from "node:fs";
import { prisma } from "../lib/prisma.js";
import { audit, diff } from "../lib/audit.js";
import { ymd, toDate } from "../lib/dates.js";
import { absoluteUploadPath, relativeUploadPath } from "../lib/upload.js";
import { HttpError } from "../middleware/error.js";
import { hasRole, type AuthUser } from "../middleware/auth.js";
import type { Prisma, QualificationEvidenceType, QualificationType } from "../generated/prisma/client.js";

/**
 * Employment Eligibility Policy, slice 1: HR enters and verifies qualification claims; the employee never
 * edits their own. Self may always read their own records; nobody else (Line Manager, HOD, Finance, Admin,
 * Management) ever can, matching the CNIC / family-details boundary in modules/employees.ts.
 */
export const canSeeQualifications = (viewer: AuthUser, employeeId: number) => viewer.id === employeeId || hasRole(viewer, "HR");

function assertAccess(viewer: AuthUser, employeeId: number) {
  if (!canSeeQualifications(viewer, employeeId)) throw new HttpError(403, "You do not have access to this employee's qualification records");
}

const include = {
  verifiedBy: { select: { fullName: true } },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.EmployeeQualificationInclude;

type Row = Prisma.EmployeeQualificationGetPayload<{ include: typeof include }>;

function present(q: Row) {
  return {
    id: q.id,
    employeeId: q.employeeId,
    type: q.type,
    evidenceType: q.evidenceType,
    institution: q.institution,
    completed: q.completed,
    completedAt: q.completedAt ? ymd(q.completedAt) : null,
    documentName: q.documentName,
    hasDocument: !!q.documentPath,
    verifiedAt: q.verifiedAt,
    verifiedBy: q.verifiedBy?.fullName ?? null,
    verified: q.completed && !!q.verifiedAt,
    note: q.note,
    createdBy: q.createdBy.fullName,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

export type QualificationStatus = "VERIFIED" | "PENDING" | "NONE";
/** VERIFIED: at least one record is completed and verified. PENDING: records exist, none verified yet. */
export function qualificationStatus(rows: { completed: boolean; verifiedAt: Date | null }[]): QualificationStatus {
  if (!rows.length) return "NONE";
  return rows.some((r) => r.completed && r.verifiedAt) ? "VERIFIED" : "PENDING";
}

/** The fields worth showing in an audit diff (never the raw file path). */
const auditSnapshot = (q: { type: string; evidenceType: string; institution: string | null; completed: boolean; completedAt: Date | null; documentName: string | null; verifiedAt: Date | null; verifiedById: number | null; note: string | null }) => ({
  type: q.type, evidenceType: q.evidenceType, institution: q.institution, completed: q.completed,
  completedAt: q.completedAt, documentName: q.documentName, verifiedAt: q.verifiedAt, verifiedById: q.verifiedById, note: q.note,
});

export async function listQualifications(employeeId: number, viewer: AuthUser) {
  assertAccess(viewer, employeeId);
  if (!(await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) {
    throw new HttpError(404, "Employee not found");
  }
  const rows = await prisma.employeeQualification.findMany({ where: { employeeId }, include, orderBy: { createdAt: "desc" } });
  if (viewer.id !== employeeId && hasRole(viewer, "HR")) {
    await audit(viewer.id, "VIEW_SENSITIVE", "EmployeeQualification", employeeId, { employeeId });
  }
  return { status: qualificationStatus(rows), records: rows.map(present) };
}

export type QualificationInput = {
  type: QualificationType;
  evidenceType: QualificationEvidenceType;
  institution?: string | null;
  completed: boolean;
  completedAt?: string | null;
  note?: string | null;
};

export async function createQualification(employeeId: number, input: QualificationInput, file: Express.Multer.File | undefined, actorId: number) {
  if (!(await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) {
    throw new HttpError(404, "Employee not found");
  }
  const data = {
    employeeId,
    type: input.type,
    evidenceType: input.evidenceType,
    institution: input.institution || null,
    completed: input.completed,
    completedAt: input.completedAt ? toDate(input.completedAt) : null,
    note: input.note || null,
    documentPath: file ? relativeUploadPath(file.path) : null,
    documentName: file ? file.originalname : null,
    createdById: actorId,
  };
  const created = await prisma.employeeQualification.create({ data, include });
  await audit(actorId, "CREATE", "EmployeeQualification", created.id, { employeeId, changes: diff({}, auditSnapshot(created)) } as Prisma.InputJsonValue);
  return present(created);
}

export type QualificationUpdateInput = Partial<QualificationInput> & { verified?: boolean };

export async function updateQualification(employeeId: number, id: number, input: QualificationUpdateInput, file: Express.Multer.File | undefined, actorId: number) {
  const before = await prisma.employeeQualification.findUnique({ where: { id } });
  if (!before || before.employeeId !== employeeId) throw new HttpError(404, "Qualification record not found");

  const data: Prisma.EmployeeQualificationUpdateInput = {};
  if (input.type !== undefined) data.type = input.type;
  if (input.evidenceType !== undefined) data.evidenceType = input.evidenceType;
  if (input.institution !== undefined) data.institution = input.institution || null;
  if (input.completed !== undefined) data.completed = input.completed;
  if (input.completedAt !== undefined) data.completedAt = input.completedAt ? toDate(input.completedAt) : null;
  if (input.note !== undefined) data.note = input.note || null;
  if (file) {
    data.documentPath = relativeUploadPath(file.path);
    data.documentName = file.originalname;
  }

  // "Verified" only ever means completed = true AND verifiedAt set (see qualificationStatus above).
  const completedNow = input.completed ?? before.completed;
  if (input.verified === true) {
    if (!completedNow) throw new HttpError(400, "Mark the qualification as completed before verifying it");
    data.verifiedAt = new Date();
    data.verifiedBy = { connect: { id: actorId } };
  } else if (input.verified === false) {
    data.verifiedAt = null;
    data.verifiedBy = { disconnect: true };
  } else if (input.completed === false && before.verifiedAt) {
    // Un-completing a previously verified record clears the stale verification rather than leaving it
    // looking verified-in-the-past while no longer meeting the completed+verifiedAt rule.
    data.verifiedAt = null;
    data.verifiedBy = { disconnect: true };
  }

  const updated = await prisma.employeeQualification.update({ where: { id }, data, include });
  await audit(actorId, "UPDATE", "EmployeeQualification", id, { employeeId, changes: diff(auditSnapshot(before), auditSnapshot(updated)) } as Prisma.InputJsonValue);
  if (file && before.documentPath) fs.rm(absoluteUploadPath(before.documentPath), { force: true }, () => {});
  return present(updated);
}

export async function qualificationDocument(employeeId: number, id: number, viewer: AuthUser) {
  const q = await prisma.employeeQualification.findUnique({ where: { id } });
  if (!q || q.employeeId !== employeeId) throw new HttpError(404, "Qualification record not found");
  assertAccess(viewer, employeeId);
  if (!q.documentPath) throw new HttpError(404, "No document attached");
  await audit(viewer.id, "VIEW_SENSITIVE", "EmployeeQualification", id, { employeeId, download: true });
  return { path: absoluteUploadPath(q.documentPath), name: q.documentName ?? "qualification-document" };
}
