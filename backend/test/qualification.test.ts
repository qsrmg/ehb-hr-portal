import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { toDate } from "../src/lib/dates.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

// Employment Eligibility Policy (effective 5 October 2026), slice 1: HR-entered, HR-verified qualification
// records. No gate exists yet (slices 2/3 are not approved) — this is data capture and access control only.
describe("Qualification records", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", path, body),
    patch: (path: string, body: Record<string, unknown>) => api.call(token[who]!, "PATCH", path, body),
  });
  const ok = (res: { status: number; data: { message?: string } }, status = 200) => assert.equal(res.status, status, res.data.message ?? "");
  const forbidden = (res: { status: number }) => assert.equal(res.status, 403);

  // The 403 cast: everyone who must never read, write or download another employee's qualification record.
  const OTHER_ROLES = ["manager", "hod", "finance", "admin", "management"];

  /** The create route takes an optional file; a separate multipart request, like the Document upload tests. */
  const createQualification = async (who: string, employeeId: number, fields: Record<string, string>, withFile = false) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (withFile) fd.append("file", new Blob(["%PDF-1.4 degree certificate"], { type: "application/pdf" }), "degree.pdf");
    const res = await fetch(`${api.base}/employees/${employeeId}/qualifications`, { method: "POST", headers: { Authorization: `Bearer ${token[who]}` }, body: fd });
    return { status: res.status, data: (await res.json()) as { id: number; message?: string } };
  };
  const downloadDocument = async (who: string, employeeId: number, qualId: number) =>
    fetch(`${api.base}/employees/${employeeId}/qualifications/${qualId}/document`, { headers: { Authorization: `Bearer ${token[who]}` } });

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const dept = await prisma.department.create({ data: { name: "Engineering" } });
    let n = 0;
    const person = async (key: string, fullName: string, roles: string[], managerId: number | null = null) => {
      n++;
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(n).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash, mustChangePassword: false,
          joiningDate: toDate("2024-01-01"), departmentId: dept.id, managerId, roles: ["EMPLOYEE", ...roles] as never,
        },
      });
      id[key] = e.id;
      return e;
    };
    const manager = await person("manager", "Hamza Malik", ["LINE_MANAGER"]);
    const hod = await person("hod", "Imran Qureshi", ["HOD"]);
    await prisma.department.update({ where: { id: dept.id }, data: { hodId: hod.id } });
    await person("hr", "Ayesha Siddiqui", ["HR"]);
    await person("employee", "Ali Raza", [], manager.id);
    await person("finance", "Bilal Ahmed", ["FINANCE"]);
    await person("admin", "Usman Tariq", ["ADMIN"]);
    await person("management", "Sana Malik", ["MANAGEMENT"]);

    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  test("HR creates a qualification record; it starts not completed and not verified, audited with before/after values", async () => {
    const res = await createQualification("hr", id.employee!, {
      type: "BACHELORS", evidenceType: "DEGREE_CERTIFICATE", institution: "LUMS", completed: "false", completedAt: "", note: "Final results awaited",
    });
    ok(res, 201);
    assert.equal(res.data.completed, false);
    assert.equal((res.data as unknown as { verified: boolean }).verified, false);

    const row = await prisma.auditLog.findFirst({ where: { action: "CREATE", entity: "EmployeeQualification", entityId: String(res.data.id) }, orderBy: { id: "desc" } });
    assert.ok(row, "audit entry recorded");
    const changes = (row!.details as { changes: Record<string, { from: unknown; to: unknown }> }).changes;
    assert.equal(changes.type!.from, null);
    assert.equal(changes.type!.to, "BACHELORS");
    assert.equal(changes.institution!.to, "LUMS");
  });

  test("only HR can create or update a qualification record", async () => {
    for (const who of [...OTHER_ROLES, "employee"]) {
      forbidden(await createQualification(who, id.employee!, { type: "BACHELORS", evidenceType: "DEGREE_CERTIFICATE", completed: "false" }));
    }
    const created = await createQualification("hr", id.employee!, { type: "BACHELORS", evidenceType: "DEGREE_CERTIFICATE", completed: "false" });
    for (const who of [...OTHER_ROLES, "employee"]) {
      forbidden(await as(who).patch(`/employees/${id.employee}/qualifications/${created.data.id}`, { completed: true }));
    }
  });

  test("self and HR can read the records; Line Manager, HOD, Finance, Admin and Management get 403, including on the document download", async () => {
    const created = await createQualification("hr", id.employee!, { type: "BACHELORS", evidenceType: "DEGREE_CERTIFICATE", completed: "true" }, true);
    ok(created, 201);

    ok(await as("employee").get(`/employees/${id.employee}/qualifications`));
    ok(await as("hr").get(`/employees/${id.employee}/qualifications`));
    for (const who of OTHER_ROLES) {
      forbidden(await as(who).get(`/employees/${id.employee}/qualifications`));
    }

    assert.equal((await downloadDocument("employee", id.employee!, created.data.id)).status, 200);
    assert.equal((await downloadDocument("hr", id.employee!, created.data.id)).status, 200);
    for (const who of OTHER_ROLES) {
      assert.equal((await downloadDocument(who, id.employee!, created.data.id)).status, 403);
    }
  });

  test("VIEW_SENSITIVE: HR opening another employee's records is audited; the employee's own read is not", async () => {
    const before = await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "EmployeeQualification", entityId: String(id.employee) } });
    await as("employee").get(`/employees/${id.employee}/qualifications`);
    assert.equal(
      await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "EmployeeQualification", entityId: String(id.employee) } }),
      before,
      "no audit row for the employee's own read",
    );
    await as("hr").get(`/employees/${id.employee}/qualifications`);
    assert.equal(
      await prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "EmployeeQualification", entityId: String(id.employee) } }),
      before + 1,
      "exactly one audit row for HR's read",
    );
  });

  test("VIEW_SENSITIVE: every document download is audited, even the employee's own", async () => {
    const created = await createQualification("hr", id.employee!, { type: "PROFESSIONAL_CERTIFICATION", evidenceType: "PROFESSIONAL_CERTIFICATION", completed: "true" }, true);
    const countFor = () => prisma.auditLog.count({ where: { action: "VIEW_SENSITIVE", entity: "EmployeeQualification", entityId: String(created.data.id) } });
    const before = await countFor();
    await downloadDocument("employee", id.employee!, created.data.id);
    assert.equal(await countFor(), before + 1, "the employee's own download is audited too");
    await downloadDocument("hr", id.employee!, created.data.id);
    assert.equal(await countFor(), before + 2);
  });

  test("verification: cannot verify until completed = true; verifying sets verifiedAt and verifiedBy; unverifying, or un-completing, clears it", async () => {
    const created = await createQualification("hr", id.employee!, { type: "OTHER", evidenceType: "PROVISIONAL_CERTIFICATE", completed: "false" });
    const qualId = created.data.id;

    assert.equal((await as("hr").patch(`/employees/${id.employee}/qualifications/${qualId}`, { verified: true })).status, 400, "cannot verify before completed");

    ok(await as("hr").patch(`/employees/${id.employee}/qualifications/${qualId}`, { completed: true }));
    const verified = await as("hr").patch(`/employees/${id.employee}/qualifications/${qualId}`, { verified: true });
    ok(verified);
    assert.ok(verified.data.verifiedAt);
    assert.equal(verified.data.verifiedBy, "Ayesha Siddiqui");
    assert.equal(verified.data.verified, true);

    const list = await as("hr").get(`/employees/${id.employee}/qualifications`);
    assert.equal(list.data.status, "VERIFIED");

    const unverified = await as("hr").patch(`/employees/${id.employee}/qualifications/${qualId}`, { verified: false });
    assert.equal(unverified.data.verifiedAt, null);
    assert.equal(unverified.data.verified, false);

    ok(await as("hr").patch(`/employees/${id.employee}/qualifications/${qualId}`, { verified: true }));
    const uncompleted = await as("hr").patch(`/employees/${id.employee}/qualifications/${qualId}`, { completed: false });
    assert.equal(uncompleted.data.verifiedAt, null, "un-completing a verified record clears the stale verification");
    assert.equal(uncompleted.data.verified, false);
  });

  test("an update is audited with before/after values", async () => {
    const created = await createQualification("hr", id.employee!, { type: "BACHELORS", evidenceType: "TRANSCRIPT", institution: "UET", completed: "false" });
    ok(await as("hr").patch(`/employees/${id.employee}/qualifications/${created.data.id}`, { institution: "UET Lahore" }));
    const row = await prisma.auditLog.findFirst({ where: { action: "UPDATE", entity: "EmployeeQualification", entityId: String(created.data.id) }, orderBy: { id: "desc" } });
    const changes = (row!.details as { changes: Record<string, { from: unknown; to: unknown }> }).changes;
    assert.equal(changes.institution!.from, "UET");
    assert.equal(changes.institution!.to, "UET Lahore");
  });

  test("the overall status is NONE with no records, PENDING with an unverified one, VERIFIED once any record is verified", async () => {
    const solo = await prisma.employee.create({
      data: {
        code: "EHB-2024-900", email: "solo@test.local", fullName: "Nida Khan", passwordHash: await bcrypt.hash(PASSWORD, 4),
        mustChangePassword: false, joiningDate: toDate("2024-01-01"), roles: ["EMPLOYEE"],
      },
    });
    assert.equal((await as("hr").get(`/employees/${solo.id}/qualifications`)).data.status, "NONE");
    const created = await createQualification("hr", solo.id, { type: "BACHELORS", evidenceType: "DEGREE_CERTIFICATE", completed: "false" });
    assert.equal((await as("hr").get(`/employees/${solo.id}/qualifications`)).data.status, "PENDING");
    await as("hr").patch(`/employees/${solo.id}/qualifications/${created.data.id}`, { completed: true });
    await as("hr").patch(`/employees/${solo.id}/qualifications/${created.data.id}`, { verified: true });
    assert.equal((await as("hr").get(`/employees/${solo.id}/qualifications`)).data.status, "VERIFIED");
  });

  test("a qualification record does not answer to the wrong employeeId in the URL", async () => {
    const created = await createQualification("hr", id.employee!, { type: "BACHELORS", evidenceType: "DEGREE_CERTIFICATE", completed: "false" });
    assert.equal((await as("hr").patch(`/employees/${id.hr}/qualifications/${created.data.id}`, { completed: true })).status, 404);
    assert.equal((await downloadDocument("hr", id.hr!, created.data.id)).status, 404);
  });

  test("a requisition can state a minimum qualification (§3), defaulting to NONE", async () => {
    const draft = await prisma.requisition.create({
      data: {
        requestedById: id.hr!, departmentId: (await prisma.employee.findUniqueOrThrow({ where: { id: id.employee }, select: { departmentId: true } })).departmentId!,
        title: "Backend Developer", reportsToId: id.manager!, targetStartDate: toDate("2027-01-01"), justification: "Growth", reason: "NEW",
      },
    });
    assert.equal(draft.minimumQualification, "NONE");
    const updated = await prisma.requisition.update({ where: { id: draft.id }, data: { minimumQualification: "BACHELORS", minimumQualificationDetail: "BSc Computer Science" } });
    assert.equal(updated.minimumQualification, "BACHELORS");
    assert.equal(updated.minimumQualificationDetail, "BSc Computer Science");
  });
});
