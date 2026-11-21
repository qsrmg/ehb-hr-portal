import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { toDate } from "../src/lib/dates.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

// Dress Code Policy (Version 1.0, October 2026): document acknowledgement (design 1), department dress code
// notes (design 2, D1/D3) and the highly confidential religious accommodation request (design 3, D4).
describe("Dress Code Policy", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};
  let engId: number;

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", path, body),
    patch: (path: string, body: Record<string, unknown>) => api.call(token[who]!, "PATCH", path, body),
  });
  const ok = (res: { status: number; data: { message?: string } }, status = 200) => assert.equal(res.status, status, res.data.message ?? "");
  const forbidden = (res: { status: number }) => assert.equal(res.status, 403);

  /** The documents upload endpoint takes a real file, so it needs its own multipart request. */
  const uploadDocument = async (who: string, fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append("file", new Blob(["%PDF-1.4 dress code policy"], { type: "application/pdf" }), "dress-code-policy.pdf");
    const res = await fetch(`${api.base}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token[who]}` }, body: fd });
    return { status: res.status, data: (await res.json()) as { id: number; message?: string } };
  };

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const eng = await prisma.department.create({ data: { name: "Engineering" } });
    const sales = await prisma.department.create({ data: { name: "Sales" } });
    engId = eng.id;
    const person = async (key: string, fullName: string, departmentId: number, roles: string[], managerId: number | null) => {
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(Object.keys(id).length + 1).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash, mustChangePassword: false,
          joiningDate: toDate("2024-01-01"), departmentId, managerId, roles: ["EMPLOYEE", ...roles] as never,
        },
      });
      id[key] = e.id;
    };
    await person("hr", "Ayesha Siddiqui", eng.id, ["HR"], null);
    await person("mgmt", "Imran Qureshi", eng.id, ["MANAGEMENT"], null);
    await person("fin", "Bilal Ahmed", eng.id, ["FINANCE"], null);
    await person("admin", "Usman Tariq", eng.id, ["ADMIN"], null);
    await person("nadia", "Nadia Khan", eng.id, ["HOD"], null); // HOD of Engineering
    await person("hamza", "Hamza Malik", eng.id, ["LINE_MANAGER"], id.nadia!);
    await person("ali", "Ali Raza", eng.id, [], id.hamza!); // reports to Hamza, in Engineering
    await person("zara", "Zara Ahmed", sales.id, [], null); // unrelated employee, different department
    await person("saira", "Saira Qureshi", sales.id, ["HOD"], null); // HOD of a different department
    await prisma.department.update({ where: { id: eng.id }, data: { hodId: id.nadia } });
    await prisma.department.update({ where: { id: sales.id }, data: { hodId: id.saira } });
    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  describe("document acknowledgement", () => {
    test("HR can require acknowledgement; an employee acknowledges with a timestamp; HR sees who has not", async () => {
      const up = await uploadDocument("hr", { title: "Dress Code Policy", category: "POLICY", requiresAcknowledgement: "true" });
      ok(up, 201);
      const docId = up.data.id;

      const list = (await as("ali").get("/documents")).data as { id: number; requiresAcknowledgement: boolean; acknowledgedAt: string | null }[];
      const mine = list.find((d) => d.id === docId)!;
      assert.equal(mine.requiresAcknowledgement, true);
      assert.equal(mine.acknowledgedAt, null);

      let who = (await as("ali").get(`/documents/${docId}/acknowledgements`));
      forbidden(who); // not HR

      who = await as("hr").get(`/documents/${docId}/acknowledgements`);
      ok(who);
      const before = who.data as { acknowledged: unknown[]; outstanding: { id: number }[] };
      assert.equal(before.acknowledged.length, 0);
      assert.ok(before.outstanding.some((e) => e.id === id.ali));

      ok(await as("ali").post(`/documents/${docId}/acknowledge`));
      const after1 = (await as("ali").get("/documents")).data as { id: number; acknowledgedAt: string | null }[];
      assert.ok(after1.find((d) => d.id === docId)!.acknowledgedAt);

      // Acknowledging again is a no-op, not a duplicate or an error. Acknowledgements are now recorded in
      // the shared PolicyAcknowledgement table (see DECISIONS.md); DocumentAcknowledgement is frozen history.
      ok(await as("ali").post(`/documents/${docId}/acknowledge`));
      const rows = await prisma.policyAcknowledgement.findMany({ where: { documentId: docId, employeeId: id.ali } });
      assert.equal(rows.length, 1);

      const after2 = await as("hr").get(`/documents/${docId}/acknowledgements`);
      const data = after2.data as { acknowledged: { id: number }[]; outstanding: { id: number }[] };
      assert.ok(data.acknowledged.some((e) => e.id === id.ali));
      assert.ok(!data.outstanding.some((e) => e.id === id.ali));
    });

    test("a document that does not require acknowledgement has no acknowledgement status", async () => {
      const up = await uploadDocument("hr", { title: "Leave Policy", category: "POLICY" });
      ok(up, 201);
      const list = (await as("ali").get("/documents")).data as { id: number; requiresAcknowledgement: boolean }[];
      assert.equal(list.find((d) => d.id === up.data.id)!.requiresAcknowledgement, false);
    });
  });

  describe("department dress code notes", () => {
    test("HR and the department's own HOD can edit; another HOD and an ordinary employee cannot", async () => {
      ok(await as("hr").patch(`/departments/${engId}/dress-code-notes`, { dressCodeNotes: "Smart casual; closed shoes on-site." }));
      let eng = (await as("ali").get("/departments")).data.find((d: { id: number }) => d.id === engId);
      assert.equal(eng.dressCodeNotes, "Smart casual; closed shoes on-site.");

      ok(await as("nadia").patch(`/departments/${engId}/dress-code-notes`, { dressCodeNotes: "Updated by the HOD." }));
      eng = (await as("ali").get("/departments")).data.find((d: { id: number }) => d.id === engId);
      assert.equal(eng.dressCodeNotes, "Updated by the HOD.");

      forbidden(await as("saira").patch(`/departments/${engId}/dress-code-notes`, { dressCodeNotes: "Not my department." }));
      forbidden(await as("ali").patch(`/departments/${engId}/dress-code-notes`, { dressCodeNotes: "Not my call." }));
    });

    test("shown to the department's own employee on their profile", async () => {
      await as("hr").patch(`/departments/${engId}/dress-code-notes`, { dressCodeNotes: "No ripped jeans." });
      const me = (await as("ali").get("/employees/me")).data;
      assert.equal(me.department.dressCodeNotes, "No ripped jeans.");
    });
  });

  describe("religious accommodation request (D4)", () => {
    test("goes to HR only: the Line Manager, Finance, Admin, Management and other employees are all refused", async () => {
      const res = await as("ali").post("/requests/religious-accommodation", { description: "I would like to wear a headscarf at work." });
      ok(res, 201);
      const reqId = res.data.id as number;

      ok(await as("ali").get(`/requests/${reqId}`)); // the employee sees their own
      ok(await as("hr").get(`/requests/${reqId}`)); // HR sees it

      forbidden(await as("hamza").get(`/requests/${reqId}`)); // Line Manager: refused
      forbidden(await as("fin").get(`/requests/${reqId}`));
      forbidden(await as("admin").get(`/requests/${reqId}`));
      forbidden(await as("mgmt").get(`/requests/${reqId}`)); // Management: refused, unlike every other request type
      forbidden(await as("zara").get(`/requests/${reqId}`)); // an unrelated employee
    });

    test("never appears in the HR/Management overview for a viewer without the HR role", async () => {
      const res = await as("zara").post("/requests/religious-accommodation", { description: "Need an exception for religious dress." });
      ok(res, 201);
      const reqId = res.data.id as number;

      const hrOverview = (await as("hr").get("/requests")).data as { id: number }[];
      assert.ok(hrOverview.some((r) => r.id === reqId));

      const mgmtOverview = (await as("mgmt").get("/requests")).data as { id: number }[];
      assert.ok(!mgmtOverview.some((r) => r.id === reqId));

      const mgmtFiltered = (await as("mgmt").get("/requests?type=RELIGIOUS_ACCOMMODATION")).data as { id: number }[];
      assert.equal(mgmtFiltered.length, 0);
    });

    test("the religion itself is never stored, and HR viewing it writes a VIEW_SENSITIVE audit entry", async () => {
      const res = await as("ali").post("/requests/religious-accommodation", { description: "I need to wear specific religious attire." });
      ok(res, 201);
      const reqId = res.data.id as number;
      const stored = await prisma.request.findUniqueOrThrow({ where: { id: reqId } });
      assert.equal(Object.keys(stored.data as object).length, 1);
      assert.ok("description" in (stored.data as object));

      await as("hr").get(`/requests/${reqId}`);
      const entries = await prisma.auditLog.findMany({ where: { action: "VIEW_SENSITIVE", entity: "ReligiousAccommodationRequest", entityId: String(reqId) } });
      assert.equal(entries.length, 1);
      assert.equal(entries[0]!.actorId, id.hr);

      // The employee viewing their own request does not need an audit entry.
      await as("ali").get(`/requests/${reqId}`);
      const entriesAfter = await prisma.auditLog.findMany({ where: { action: "VIEW_SENSITIVE", entity: "ReligiousAccommodationRequest", entityId: String(reqId) } });
      assert.equal(entriesAfter.length, 1);
    });

    test("HR can approve it like any other HR-only request", async () => {
      const res = await as("ali").post("/requests/religious-accommodation", { description: "Requesting an accommodation." });
      ok(res, 201);
      const reqId = res.data.id as number;
      ok(await as("hr").post(`/requests/${reqId}/approve`, { comment: "Approved; accommodated." }));
      const detail = (await as("hr").get(`/requests/${reqId}`)).data;
      assert.equal(detail.status, "APPROVED");
    });
  });
});
