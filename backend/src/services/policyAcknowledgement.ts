import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../middleware/error.js";
import { ACTIVITY_MONITORING_POLICY_KEY, documentIdFromPolicyKey, isRegisteredPolicyKey, POLICY_REGISTRY } from "../lib/policies.js";

/**
 * One shared mechanism behind every "I have read / I agree" acknowledgement in the portal (see
 * PolicyAcknowledgement in schema.prisma). A policyKey is either one of the static POLICY_REGISTRY keys,
 * or "document:<documentId>" for a Document that requires acknowledgement; anything else is an unknown
 * policy (404), per the registry-or-existing-document rule.
 */
async function resolvePolicy(policyKey: string): Promise<{ version: number; documentId: number | null }> {
  if (isRegisteredPolicyKey(policyKey)) return { version: POLICY_REGISTRY[policyKey].version, documentId: null };
  const documentId = documentIdFromPolicyKey(policyKey);
  if (documentId != null) {
    const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { id: true } });
    if (doc) return { version: 1, documentId };
  }
  throw new HttpError(404, "Unknown policy");
}

const isUniqueViolation = (err: unknown) => err != null && typeof err === "object" && "code" in err && err.code === "P2002";

/**
 * Records that `employeeId` has acknowledged the current version of `policyKey`, and writes one audit
 * entry under (auditEntity, auditEntityId) — the same shape every acknowledgement already wrote before
 * this mechanism existed (e.g. ("Document", documentId)), so existing audit queries keep working.
 *
 * A duplicate acknowledgement (double-click, two tabs both submitting) races on the same unique row: the
 * loser's insert fails with a unique-constraint violation, which is treated as "already acknowledged" —
 * never a 500 — and the existing row is returned instead.
 */
export async function acknowledgePolicy(employeeId: number, policyKey: string, auditEntity: string, auditEntityId: string | number | null) {
  const { version, documentId } = await resolvePolicy(policyKey);
  let row;
  try {
    row = await prisma.policyAcknowledgement.create({ data: { policyKey, version, employeeId, documentId } });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    row = await prisma.policyAcknowledgement.findUniqueOrThrow({ where: { policyKey_version_employeeId: { policyKey, version, employeeId } } });
  }
  await audit(employeeId, "ACKNOWLEDGE", auditEntity, auditEntityId);
  return row;
}

export async function hasAcknowledged(employeeId: number, policyKey: string, version?: number) {
  const v = version ?? (await resolvePolicy(policyKey)).version;
  return (await prisma.policyAcknowledgement.findUnique({ where: { policyKey_version_employeeId: { policyKey, version: v, employeeId } } })) != null;
}

/** The ACTIVE employees who are expected to acknowledge this policy — HR's report shows outstanding among these. */
async function expectedAudience(policyKey: string) {
  if (policyKey === ACTIVITY_MONITORING_POLICY_KEY) {
    const excluded = await prisma.activityExclusion.findMany({ select: { employeeId: true } });
    const excludedIds = excluded.map((e) => e.employeeId);
    return prisma.employee.findMany({
      where: { status: "ACTIVE", ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}) },
      select: { id: true, fullName: true, code: true, status: true },
      orderBy: { fullName: "asc" },
    });
  }
  return prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true, fullName: true, code: true, status: true }, orderBy: { fullName: "asc" } });
}

/** HR report: who has and has not acknowledged the current version of this policy. Names, codes and status only. */
export async function getAcknowledgementReport(policyKey: string) {
  const { version } = await resolvePolicy(policyKey);
  const [acknowledged, pool] = await Promise.all([
    prisma.policyAcknowledgement.findMany({
      where: { policyKey, version },
      include: { employee: { select: { id: true, fullName: true, code: true } } },
      orderBy: { acknowledgedAt: "asc" },
    }),
    expectedAudience(policyKey),
  ]);
  const ackedIds = new Set(acknowledged.map((a) => a.employeeId));
  return {
    acknowledged: acknowledged.map((a) => ({ id: a.employee.id, fullName: a.employee.fullName, code: a.employee.code, acknowledgedAt: a.acknowledgedAt })),
    outstanding: pool.filter((e) => !ackedIds.has(e.id)),
  };
}

/** Whether a document can be deleted: never while it still has acknowledgement rows recorded against it. */
export async function documentHasAcknowledgements(documentId: number) {
  return (await prisma.policyAcknowledgement.count({ where: { documentId } })) > 0;
}
