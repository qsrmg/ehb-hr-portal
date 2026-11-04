import { prisma } from "../lib/prisma.js";
import { ymd } from "../lib/dates.js";
import { hasRole, type AuthUser } from "../middleware/auth.js";
import type { Prisma } from "../generated/prisma/client.js";

type Db = typeof prisma | Prisma.TransactionClient;

export const TAG_PREFIX = "EHB-AST-";

/** Next generated tag: EHB-AST-0001, EHB-AST-0002, … (existing tags in other formats are ignored). */
export async function nextAssetTag(db: Db = prisma) {
  const rows = await db.asset.findMany({ where: { tag: { startsWith: TAG_PREFIX } }, select: { tag: true } });
  const max = rows.reduce((m, r) => {
    const n = Number(r.tag.slice(TAG_PREFIX.length));
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `${TAG_PREFIX}${String(max + 1).padStart(4, "0")}`;
}

/** Cost values (purchase cost, repair cost) are for Admin, Finance and Management. */
export const canSeeCost = (user: AuthUser) => hasRole(user, "ADMIN", "FINANCE", "MANAGEMENT");
/** The full register: Admin manages it; HR, Finance and Management can look. */
export const canSeeRegister = (user: AuthUser) => hasRole(user, "ADMIN", "HR", "FINANCE", "MANAGEMENT");

export const RESOLVED_FOR_EXIT = ["RECOVERY_SET", "WRITTEN_OFF"] as const;

/**
 * Exit clearance for assets. An employee is cleared when every item they still hold in a category that
 * must be returned on exit (including access & accounts, which must be revoked) is either returned,
 * written off by Management, or has a recovery amount set by HR. Items assigned to a department or
 * location never block a person's clearance. Used by Resignation & exit clearance.
 */
export async function assetClearance(employeeId: number) {
  const open = await prisma.assetAssignment.findMany({
    where: { employeeId, assigneeType: "EMPLOYEE", returnedAt: null },
    include: { asset: { include: { category: true } }, incidents: true },
    orderBy: { issuedAt: "asc" },
  });
  const outstanding = open
    .filter((a) => a.asset.category.mustReturnOnExit)
    .filter((a) => !a.incidents.some((i) => (RESOLVED_FOR_EXIT as readonly string[]).includes(i.status)))
    .map((a) => ({
      assignmentId: a.id,
      assetId: a.assetId,
      tag: a.asset.tag,
      name: a.asset.name,
      category: a.asset.category.name,
      kind: a.asset.category.kind,
      issuedAt: a.issuedAt,
      action: a.asset.category.kind === "ACCESS" ? "Revoke" : a.asset.status === "LOST" ? "Recover or write off" : "Return",
    }));
  const incidents = await prisma.assetIncident.findMany({
    where: { employeeId },
    include: { asset: { select: { tag: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const recoveries = incidents
    .filter((i) => i.status === "RECOVERY_SET")
    .map((i) => ({ incidentId: i.id, tag: i.asset.tag, name: i.asset.name, type: i.type, amount: Number(i.recoveryAmount), note: i.recoveryNote }));
  // Not blocking, but HR / Management still have to decide these.
  const pendingDecisions = incidents
    .filter((i) => i.status === "REPORTED" || i.status === "RECORDED")
    .map((i) => ({ incidentId: i.id, tag: i.asset.tag, name: i.asset.name, type: i.type, status: i.status }));
  return {
    employeeId,
    cleared: outstanding.length === 0,
    outstanding,
    recoveries,
    recoveryTotal: Math.round(recoveries.reduce((s, r) => s + r.amount, 0) * 100) / 100,
    pendingDecisions,
    stillHeldNotRequired: open.filter((a) => !a.asset.category.mustReturnOnExit).map((a) => ({ tag: a.asset.tag, name: a.asset.name, category: a.asset.category.name })),
  };
}

export const assetInclude = {
  category: true,
  assignments: {
    orderBy: { issuedAt: "desc" },
    include: {
      employee: { select: { id: true, fullName: true, code: true } },
      department: { select: { id: true, name: true } },
      issuedBy: { select: { fullName: true } },
      receivedBy: { select: { fullName: true } },
      request: { select: { requestId: true } },
    },
  },
  repairs: { orderBy: { sentOn: "desc" }, include: { createdBy: { select: { fullName: true } } } },
  incidents: {
    orderBy: { createdAt: "desc" },
    include: {
      employee: { select: { fullName: true, code: true } },
      reportedBy: { select: { fullName: true } },
      recordedBy: { select: { fullName: true } },
      recoverySetBy: { select: { fullName: true } },
      writtenOffBy: { select: { fullName: true } },
    },
  },
} satisfies Prisma.AssetInclude;

type AssetFull = Prisma.AssetGetPayload<{ include: typeof assetInclude }>;
type AssignmentRow = AssetFull["assignments"][number];

const d = (v: Date | null) => (v ? ymd(v) : null);
const num = (v: { toString(): string } | null) => (v == null ? null : Number(v));

export const assigneeLabel = (a: Pick<AssignmentRow, "assigneeType" | "location"> & { employee: { fullName: string; code: string } | null; department: { name: string } | null }) =>
  a.assigneeType === "EMPLOYEE" ? `${a.employee?.fullName} (${a.employee?.code})` : a.assigneeType === "DEPARTMENT" ? `Department: ${a.department?.name}` : `Location: ${a.location}`;

export function serializeAssignment(a: AssignmentRow) {
  return {
    id: a.id,
    assigneeType: a.assigneeType,
    assignee: assigneeLabel(a),
    employee: a.employee,
    department: a.department,
    location: a.location,
    issuedAt: a.issuedAt,
    issuedBy: a.issuedBy.fullName,
    conditionOut: a.conditionOut,
    issueNote: a.issueNote,
    confirmedAt: a.confirmedAt,
    returnedAt: a.returnedAt,
    receivedBy: a.receivedBy?.fullName ?? null,
    conditionIn: a.conditionIn,
    returnNote: a.returnNote,
    requestId: a.request?.requestId ?? null,
  };
}

export function serializeIncident(i: AssetFull["incidents"][number], showMoney = true) {
  return {
    id: i.id,
    type: i.type,
    status: i.status,
    description: i.description,
    employee: i.employee,
    reportedBy: i.reportedBy.fullName,
    createdAt: i.createdAt,
    recordedBy: i.recordedBy?.fullName ?? null,
    recordedAt: i.recordedAt,
    adminNote: i.adminNote,
    recoveryAmount: showMoney ? num(i.recoveryAmount) : null,
    recoverySetBy: i.recoverySetBy?.fullName ?? null,
    recoverySetAt: i.recoverySetAt,
    recoveryNote: i.recoveryNote,
    writtenOffBy: i.writtenOffBy?.fullName ?? null,
    writtenOffAt: i.writtenOffAt,
    writeOffNote: i.writeOffNote,
  };
}

export function serializeAsset(a: AssetFull, user: AuthUser) {
  const cost = canSeeCost(user);
  const current = a.assignments.find((x) => !x.returnedAt) ?? null;
  return {
    id: a.id,
    tag: a.tag,
    name: a.name,
    category: { id: a.category.id, name: a.category.name, kind: a.category.kind, mustReturnOnExit: a.category.mustReturnOnExit },
    serialNumber: a.serialNumber,
    purchaseDate: d(a.purchaseDate),
    cost: cost ? num(a.cost) : undefined,
    warrantyUntil: d(a.warrantyUntil),
    condition: a.condition,
    status: a.status,
    storageLocation: a.storageLocation,
    notes: a.notes,
    current: current ? serializeAssignment(current) : null,
    assignments: a.assignments.map(serializeAssignment),
    repairs: a.repairs.map((r) => ({
      id: r.id, vendor: r.vendor, sentOn: d(r.sentOn), returnedOn: d(r.returnedOn), cost: cost ? num(r.cost) : undefined, note: r.note, createdBy: r.createdBy.fullName,
    })),
    incidents: a.incidents.map((i) => serializeIncident(i, hasRole(user, "ADMIN", "HR", "FINANCE", "MANAGEMENT"))),
  };
}
