import { prisma } from "./prisma.js";
import type { Prisma } from "../generated/prisma/client.js";

export async function audit(
  actorId: number | null,
  action: string,
  entity: string,
  entityId?: string | number | null,
  details?: Prisma.InputJsonValue,
) {
  await prisma.auditLog.create({
    data: { actorId, action, entity, entityId: entityId == null ? null : String(entityId), details: details ?? {} },
  });
}

/** Returns {field: {from, to}} for fields whose value changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(after)) {
    if (to === undefined) continue;
    const from = before[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""));
    if (norm(from) !== norm(to)) changes[key] = { from: from ?? null, to: to ?? null };
  }
  return changes;
}
