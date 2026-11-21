import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { toDate } from "../src/lib/dates.js";
import { acknowledgePolicy, getAcknowledgementReport, hasAcknowledged } from "../src/services/policyAcknowledgement.js";
import { ACTIVITY_MONITORING_POLICY_KEY } from "../src/lib/policies.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

/**
 * The shared PolicyAcknowledgement mechanism behind both the Dress Code document acknowledgement (see
 * dress-code.test.ts) and the activity-monitoring policy acknowledgement (see activity.test.ts). Those two
 * files prove the day-to-day behaviour is unchanged; this file proves the shared parts: concurrency,
 * version bumps, the generic HR report, the document-delete guard, and the migration backfill.
 */
describe("Shared policy acknowledgement", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", path, body),
    delete: (path: string) => api.call(token[who]!, "DELETE", path),
  });
  const ok = (res: { status: number; data: { message?: string } }, status = 200) => assert.equal(res.status, status, res.data.message ?? "");
  const forbidden = (res: { status: number }) => assert.equal(res.status, 403);

  const uploadDocument = async (who: string, fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append("file", new Blob(["%PDF-1.4 policy"], { type: "application/pdf" }), "policy.pdf");
    const res = await fetch(`${api.base}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token[who]}` }, body: fd });
    return { status: res.status, data: (await res.json()) as { id: number; message?: string } };
  };

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const eng = await prisma.department.create({ data: { name: "Engineering" } });
    const person = async (key: string, fullName: string, roles: string[]) => {
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(Object.keys(id).length + 1).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash, mustChangePassword: false,
          joiningDate: toDate("2024-01-01"), departmentId: eng.id, roles: ["EMPLOYEE", ...roles] as never,
        },
      });
      id[key] = e.id;
    };
    await person("hr", "Ayesha Siddiqui", ["HR"]);
    await person("ali", "Ali Raza", []);
    await person("zara", "Zara Ahmed", []);
    await person("sara", "Sara Javed", []);
    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  test("an unknown policy key is 404, for both HR's report and an attempted acknowledgement", async () => {
    const res = await as("hr").get("/policies/not-a-real-policy/acknowledgements");
    assert.equal(res.status, 404);
    await assert.rejects(() => acknowledgePolicy(id.ali!, "not-a-real-policy", "Policy", "not-a-real-policy"));
  });

  test("the generic HR report is 403 for everyone else, and matches the document's own report", async () => {
    const up = await uploadDocument("hr", { title: "Code of Conduct", category: "POLICY", requiresAcknowledgement: "true" });
    assert.equal(up.status, 201);
    const docId = up.data.id;
    forbidden(await as("ali").get(`/policies/document:${docId}/acknowledgements`));
    ok(await as("ali").post(`/documents/${docId}/acknowledge`));

    const viaPolicies = await as("hr").get(`/policies/document:${docId}/acknowledgements`);
    const viaDocument = await as("hr").get(`/documents/${docId}/acknowledgements`);
    ok(viaPolicies);
    ok(viaDocument);
    assert.deepEqual(viaPolicies.data, viaDocument.data);
    assert.ok((viaPolicies.data as { acknowledged: { id: number }[] }).acknowledged.some((e) => e.id === id.ali));
  });

  test("a duplicate acknowledgement (two tabs racing the same unique row) is treated as already acknowledged, never a 500", async () => {
    const up = await uploadDocument("hr", { title: "Remote Work Policy", category: "POLICY", requiresAcknowledgement: "true" });
    const docId = up.data.id;
    const policyKey = `document:${docId}`;

    // The loser of the race hits the same unique constraint acknowledgePolicy() already upserts through;
    // simulate it directly against the shared service rather than trying to win an actual OS-level race.
    const first = await acknowledgePolicy(id.zara!, policyKey, "Document", docId);
    const second = await acknowledgePolicy(id.zara!, policyKey, "Document", docId);
    assert.equal(first.id, second.id);
    assert.equal(first.acknowledgedAt.getTime(), second.acknowledgedAt.getTime());
    const rows = await prisma.policyAcknowledgement.findMany({ where: { policyKey, employeeId: id.zara! } });
    assert.equal(rows.length, 1);

    // The HTTP path never surfaces a 500 for the same double-submit.
    const [r1, r2] = await Promise.all([as("zara").post(`/documents/${docId}/acknowledge`), as("zara").post(`/documents/${docId}/acknowledge`)]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
  });

  test("version bump forces re-acknowledgement: an old-version row does not satisfy the current version", async () => {
    // Simulates "the policy's version was bumped in code": a row recorded under a fabricated OLD version
    // existed before the bump, and must not satisfy ACTIVITY_MONITORING_POLICY_VERSION (1 in this build).
    const OLD_VERSION = 0;
    await prisma.policyAcknowledgement.create({ data: { policyKey: ACTIVITY_MONITORING_POLICY_KEY, version: OLD_VERSION, employeeId: id.sara! } });
    assert.equal(await hasAcknowledged(id.sara!, ACTIVITY_MONITORING_POLICY_KEY, OLD_VERSION), true);
    assert.equal(await hasAcknowledged(id.sara!, ACTIVITY_MONITORING_POLICY_KEY), false, "the old-version row must not satisfy the policy's current version");

    // Acknowledging now (the current version) adds a new row; the old-version row is kept, never rewritten.
    await acknowledgePolicy(id.sara!, ACTIVITY_MONITORING_POLICY_KEY, "Policy", ACTIVITY_MONITORING_POLICY_KEY);
    assert.equal(await hasAcknowledged(id.sara!, ACTIVITY_MONITORING_POLICY_KEY), true);
    const rows = await prisma.policyAcknowledgement.findMany({ where: { policyKey: ACTIVITY_MONITORING_POLICY_KEY, employeeId: id.sara! }, orderBy: { version: "asc" } });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.version, OLD_VERSION);
    assert.equal(rows[1]!.version, 1);
  });

  test("the activity-monitoring report excludes employees on the ActivityExclusion list from 'outstanding', and carries no activity data", async () => {
    await prisma.activityExclusion.create({ data: { employeeId: id.zara!, excludedById: id.hr! } });
    const report = await getAcknowledgementReport(ACTIVITY_MONITORING_POLICY_KEY);
    assert.ok(!report.outstanding.some((e) => e.id === id.zara), "excluded employee must not appear as outstanding");
    assert.ok(report.outstanding.some((e) => e.id === id.ali), "a non-excluded, non-acknowledged employee must appear as outstanding");
    const allowedFields = new Set(["id", "fullName", "code", "status", "acknowledgedAt"]);
    for (const row of [...report.acknowledged, ...report.outstanding]) {
      for (const field of Object.keys(row)) assert.ok(allowedFields.has(field), `unexpected field "${field}" — this report must carry no activity data`);
    }
    await prisma.activityExclusion.delete({ where: { employeeId: id.zara! } });
  });

  describe("a document with acknowledgement rows cannot be deleted", () => {
    test("blocked (409) while rows exist; allowed once there are none; the rows are never removed", async () => {
      const withAck = await uploadDocument("hr", { title: "Data Handling Policy", category: "POLICY", requiresAcknowledgement: "true" });
      const withAckId = withAck.data.id;
      ok(await as("ali").post(`/documents/${withAckId}/acknowledge`));

      const blocked = await as("hr").delete(`/documents/${withAckId}`);
      assert.equal(blocked.status, 409);
      assert.match(blocked.data.message ?? "", /acknowledgement/i);
      const stillThere = await prisma.document.findUnique({ where: { id: withAckId } });
      assert.ok(stillThere, "the document itself must not be deleted either");
      const rowsAfter = await prisma.policyAcknowledgement.count({ where: { documentId: withAckId } });
      assert.equal(rowsAfter, 1, "the acknowledgement row must survive the blocked delete attempt");

      const withoutAck = await uploadDocument("hr", { title: "Unused Form", category: "HR_FORM" });
      const withoutAckId = withoutAck.data.id;
      const allowed = await as("hr").delete(`/documents/${withoutAckId}`);
      assert.equal(allowed.status, 200);
      assert.equal(await prisma.document.findUnique({ where: { id: withoutAckId } }), null);
    });
  });

  describe("migration backfill (row-for-row parity with the frozen old tables)", () => {
    test("copying DocumentAcknowledgement and ActivityPolicyAcknowledgement rows reproduces them exactly in PolicyAcknowledgement", async () => {
      const up = await uploadDocument("hr", { title: "Legacy-Shape Policy", category: "POLICY", requiresAcknowledgement: "true" });
      const docId = up.data.id;
      const oldDocRow = await prisma.documentAcknowledgement.create({ data: { documentId: docId, employeeId: id.ali! } });
      // id.hr, not id.sara: an earlier test in this file already has sara acknowledge activity-monitoring
      // directly through PolicyAcknowledgement, which would collide with this fixture's own insert into it.
      const oldActivityRow = await prisma.activityPolicyAcknowledgement.create({ data: { employeeId: id.hr!, policyVersion: 1 } });

      // The exact two statements the migration (20261121061300_policy_acknowledgement/migration.sql) backfills
      // with, re-run here against fixture rows this test controls so the comparison is self-contained.
      const migrationSql = fs.readFileSync(
        path.join(import.meta.dirname, "../prisma/migrations/20261121061300_policy_acknowledgement/migration.sql"),
        "utf8",
      );
      const inserts = migrationSql.match(/INSERT INTO[\s\S]*?FROM "(?:DocumentAcknowledgement|ActivityPolicyAcknowledgement)";/g);
      assert.equal(inserts?.length, 2, "expected exactly the two backfill INSERT...SELECT statements in the migration file");
      for (const stmt of inserts!) await prisma.$executeRawUnsafe(stmt);

      const newDocRow = await prisma.policyAcknowledgement.findUnique({ where: { policyKey_version_employeeId: { policyKey: `document:${docId}`, version: 1, employeeId: id.ali! } } });
      assert.ok(newDocRow);
      assert.equal(newDocRow!.documentId, docId);
      assert.equal(newDocRow!.acknowledgedAt.getTime(), oldDocRow.acknowledgedAt.getTime());

      const newActivityRow = await prisma.policyAcknowledgement.findUnique({ where: { policyKey_version_employeeId: { policyKey: "activity-monitoring", version: 1, employeeId: id.hr! } } });
      assert.ok(newActivityRow);
      assert.equal(newActivityRow!.documentId, null);
      assert.equal(newActivityRow!.acknowledgedAt.getTime(), oldActivityRow.acknowledgedAt.getTime());

      // Neither source row was touched by the copy.
      assert.equal(await prisma.documentAcknowledgement.count(), 1);
      assert.equal(await prisma.activityPolicyAcknowledgement.count(), 1);
    });
  });
});
