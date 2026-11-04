import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { prisma } from "../src/lib/prisma.js";
import { toDate } from "../src/lib/dates.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

describe("My Inventory (assets)", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};
  const cat: Record<string, number> = {};
  let engDept: number;

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", path, body),
    patch: (path: string, body: Record<string, unknown>) => api.call(token[who]!, "PATCH", path, body),
  });
  const newAsset = async (categoryId: number, extra: Record<string, unknown> = {}) => {
    const res = await as("usman").post("/assets", { categoryId, name: "Dell Latitude 5440", serialNumber: "SN-" + Math.random().toString(36).slice(2, 8), cost: 285000, ...extra });
    assert.equal(res.status, 201, res.data.message);
    return res.data as { id: number; tag: string };
  };
  const issueTo = (assetId: number, employee: string, extra: Record<string, unknown> = {}) =>
    as("usman").post(`/assets/${assetId}/issue`, { assigneeType: "EMPLOYEE", employeeId: id[employee], ...extra });
  const clearance = async (who: string) => (await as("hr").get(`/assets/clearance/${id[who]}`)).data;
  const notes = (who: string, prefix: string) => prisma.notification.findMany({ where: { employeeId: id[who], title: { startsWith: prefix } } });

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const mgmt = await prisma.department.create({ data: { name: "Management" } });
    const eng = await prisma.department.create({ data: { name: "Engineering" } });
    engDept = eng.id;
    const person = async (key: string, fullName: string, departmentId: number, roles: string[], managerId: number | null) => {
      const e = await prisma.employee.create({
        data: {
          code: `EHB-2024-${String(Object.keys(id).length + 1).padStart(3, "0")}`, email: `${key}@test.local`, fullName, passwordHash, mustChangePassword: false,
          joiningDate: toDate("2024-01-01"), departmentId, managerId, roles: ["EMPLOYEE", ...roles] as never,
        },
      });
      id[key] = e.id;
    };
    await person("ceo", "Imran Qureshi", mgmt.id, ["MANAGEMENT"], null);
    await person("hr", "Ayesha Siddiqui", mgmt.id, ["HR"], id.ceo!);
    await person("fin", "Bilal Ahmed", mgmt.id, ["FINANCE"], id.ceo!);
    await person("usman", "Usman Tariq", mgmt.id, ["ADMIN"], id.ceo!);
    await person("hamza", "Hamza Malik", eng.id, ["LINE_MANAGER", "HOD"], id.ceo!);
    await person("ali", "Ali Raza", eng.id, [], id.hamza!);
    await person("sara", "Sara Javed", eng.id, [], id.hamza!);
    cat.laptop = (await prisma.assetCategory.create({ data: { name: "Laptop", sortOrder: 1 } })).id;
    cat.accessories = (await prisma.assetCategory.create({ data: { name: "Accessories", mustReturnOnExit: false, sortOrder: 2 } })).id;
    cat.other = (await prisma.assetCategory.create({ data: { name: "Other", sortOrder: 3 } })).id;
    cat.access = (await prisma.assetCategory.create({ data: { name: "Access & accounts", kind: "ACCESS", sortOrder: 4 } })).id;
    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  describe("register and tags", () => {
    test("keeps an existing tag, otherwise generates EHB-AST-0001, 0002…", async () => {
      assert.equal((await newAsset(cat.laptop!, { tag: "OLD-LT-77" })).tag, "OLD-LT-77");
      assert.equal((await newAsset(cat.laptop!)).tag, "EHB-AST-0001");
      assert.equal((await newAsset(cat.laptop!)).tag, "EHB-AST-0002");
      assert.equal((await as("usman").post("/assets", { categoryId: cat.laptop, name: "Dup", tag: "OLD-LT-77" })).status, 409);
    });

    test("only Admin manages assets and categories", async () => {
      assert.equal((await as("hr").post("/assets", { categoryId: cat.laptop, name: "X" })).status, 403);
      assert.equal((await as("ali").post("/assets/categories", { name: "Drones" })).status, 403);
      const created = await as("usman").post("/assets/categories", { name: "Tablet", mustReturnOnExit: true });
      assert.equal(created.status, 201);
      assert.equal((await as("usman").post("/assets/categories", { name: "Tablet" })).status, 409);
    });

    test("warranty date and purchase details are stored", async () => {
      const a = await newAsset(cat.laptop!, { purchaseDate: "2026-01-15", warrantyUntil: "2029-01-15" });
      const d = (await as("usman").get(`/assets/${a.id}`)).data;
      assert.deepEqual({ p: d.purchaseDate, w: d.warrantyUntil, cost: d.cost }, { p: "2026-01-15", w: "2029-01-15", cost: 285000 });
    });
  });

  describe("issue, confirm, transfer, return", () => {
    let laptop: { id: number; tag: string };

    before(async () => {
      laptop = await newAsset(cat.laptop!);
    });

    test("issue to an employee: awaiting their confirmation; only they can confirm", async () => {
      assert.equal((await issueTo(laptop.id, "ali")).status, 200);
      assert.equal((await issueTo(laptop.id, "sara")).status, 400, "already issued");
      const mine = (await as("ali").get("/assets/mine")).data;
      const row = mine.find((m: { asset: { tag: string } }) => m.asset.tag === laptop.tag);
      assert.equal(row.confirmedAt, null);
      assert.equal((await notes("ali", "Item issued to you")).length >= 1, true);
      assert.equal((await as("sara").post(`/assets/assignments/${row.id}/confirm`)).status, 404);
      assert.equal((await as("ali").post(`/assets/assignments/${row.id}/confirm`)).status, 200);
      assert.equal((await as("ali").post(`/assets/assignments/${row.id}/confirm`)).status, 400, "already confirmed");
    });

    test("visibility: employees see their own items; HR sees the register without cost; Finance sees cost; managers see their team", async () => {
      assert.equal((await as("ali").get("/assets")).status, 403);
      assert.equal((await as("ali").get(`/assets/${laptop.id}`)).status, 403);
      assert.equal((await as("hr").get(`/assets/${laptop.id}`)).data.cost, undefined);
      assert.equal((await as("fin").get(`/assets/${laptop.id}`)).data.cost, 285000);
      const team = (await as("hamza").get("/assets/team")).data;
      assert.ok(team.some((t: { asset: { tag: string }; employee: { fullName: string } }) => t.asset.tag === laptop.tag && t.employee.fullName === "Ali Raza"));
      assert.equal(JSON.stringify(team).includes("285000"), false, "no cost for managers");
      assert.equal((await as("sara").get(`/assets/clearance/${id.ali}`)).status, 403);
    });

    test("transfer to another employee keeps the history", async () => {
      assert.equal((await as("usman").post(`/assets/${laptop.id}/transfer`, { assigneeType: "EMPLOYEE", employeeId: id.sara })).status, 200);
      const d = (await as("usman").get(`/assets/${laptop.id}`)).data;
      assert.equal(d.assignments.length, 2);
      assert.match(d.current.assignee, /Sara Javed/);
      assert.equal(d.assignments[1].returnNote, "Transferred");
      assert.equal(d.current.confirmedAt, null, "the new holder confirms");
    });

    test("return puts the item back in stock with the condition seen on return", async () => {
      assert.equal((await as("usman").post(`/assets/${laptop.id}/return`, { condition: "FAIR", note: "Scratched lid" })).status, 200);
      const d = (await as("usman").get(`/assets/${laptop.id}`)).data;
      assert.deepEqual({ status: d.status, condition: d.condition, current: d.current }, { status: "IN_STOCK", condition: "FAIR", current: null });
      assert.equal(d.assignments[0].conditionIn, "FAIR");
      assert.equal((await as("usman").post(`/assets/${laptop.id}/return`)).status, 400, "not issued");
    });
  });

  describe("departments, locations and access & accounts", () => {
    test("department and location items need no confirmation and never block a person's exit", async () => {
      const printer = await newAsset(cat.other!, { name: "HP LaserJet" });
      assert.equal((await as("usman").post(`/assets/${printer.id}/issue`, { assigneeType: "DEPARTMENT", departmentId: engDept })).status, 200);
      const tv = await newAsset(cat.other!, { name: "Meeting room TV" });
      assert.equal((await as("usman").post(`/assets/${tv.id}/issue`, { assigneeType: "LOCATION", location: "Meeting room 2" })).status, 200);
      const d = (await as("usman").get(`/assets/${tv.id}`)).data;
      assert.ok(d.current.confirmedAt);
      assert.equal(d.current.assignee, "Location: Meeting room 2");
      assert.equal((await clearance("hamza")).cleared, true);
    });

    test("access is granted without confirmation, blocks exit until revoked", async () => {
      const email = await newAsset(cat.access!, { name: "Google Workspace email", serialNumber: "omar@ehb.pk", cost: null });
      await issueTo(email.id, "sara");
      const before = await clearance("sara");
      assert.equal(before.cleared, false);
      assert.deepEqual(before.outstanding.map((o: { name: string; action: string }) => `${o.name}: ${o.action}`), ["Google Workspace email: Revoke"]);
      assert.equal((await as("usman").post(`/assets/${email.id}/return`, { note: "Account suspended" })).status, 200);
      assert.equal((await clearance("sara")).cleared, true);
      assert.equal((await notes("sara", "Access revoked")).length, 1);
    });
  });

  describe("repairs", () => {
    test("repair log: sent (from stock), cannot be issued meanwhile, returned with cost", async () => {
      const a = await newAsset(cat.laptop!);
      await issueTo(a.id, "ali");
      assert.equal((await as("usman").post(`/assets/${a.id}/repairs`, { vendor: "Dell Service", sentOn: "2026-11-01" })).status, 400, "must be returned first");
      await as("usman").post(`/assets/${a.id}/return`);
      assert.equal((await as("usman").post(`/assets/${a.id}/repairs`, { vendor: "Dell Service", sentOn: "2026-11-01", note: "Battery swelling" })).status, 200);
      assert.equal((await as("usman").get(`/assets/${a.id}`)).data.status, "IN_REPAIR");
      assert.equal((await issueTo(a.id, "sara")).status, 400);
      const repairId = (await as("usman").get(`/assets/${a.id}`)).data.repairs[0].id;
      assert.equal((await as("usman").post(`/assets/${a.id}/repairs/${repairId}/returned`, { returnedOn: "2026-11-03", cost: 18000 })).status, 200);
      const d = (await as("fin").get(`/assets/${a.id}`)).data;
      assert.deepEqual({ status: d.status, vendor: d.repairs[0].vendor, cost: d.repairs[0].cost, back: d.repairs[0].returnedOn }, { status: "IN_STOCK", vendor: "Dell Service", cost: 18000, back: "2026-11-03" });
      assert.equal((await as("hr").get(`/assets/${a.id}`)).data.repairs[0].cost, undefined, "HR does not see costs");
    });
  });

  describe("damage, loss and exit clearance", () => {
    let laptop: { id: number; tag: string };
    let mouse: { id: number; tag: string };

    before(async () => {
      laptop = await newAsset(cat.laptop!, { name: "ThinkPad T14" });
      mouse = await newAsset(cat.accessories!, { name: "Logitech mouse" });
      await issueTo(laptop.id, "ali");
      await issueTo(mouse.id, "ali");
    });

    test("an issued returnable item blocks exit; accessories do not", async () => {
      const c = await clearance("ali");
      assert.equal(c.cleared, false);
      assert.deepEqual(c.outstanding.map((o: { tag: string }) => o.tag), [laptop.tag]);
      assert.ok(c.stillHeldNotRequired.some((s: { tag: string }) => s.tag === mouse.tag));
    });

    test("employee reports the laptop lost; Admin records it; HR and Management are told", async () => {
      const mine = (await as("ali").get("/assets/mine")).data.find((m: { asset: { tag: string } }) => m.asset.tag === laptop.tag);
      const rep = await as("ali").post(`/assets/assignments/${mine.id}/report`, { type: "LOST", description: "Left in a taxi on Monday" });
      assert.equal(rep.status, 201);
      assert.equal((await notes("usman", "Problem reported")).length, 1);
      assert.equal((await as("hr").post(`/assets/incidents/${rep.data.id}/recovery`, { amount: 1000, note: "x" })).status, 400, "Admin must record it first");
      assert.equal((await as("usman").post(`/assets/incidents/${rep.data.id}/record`, { type: "LOST", note: "Police report filed" })).status, 200);
      assert.equal((await as("usman").get(`/assets/${laptop.id}`)).data.status, "LOST");
      assert.equal((await notes("hr", "Asset lost")).length, 1);
      assert.equal((await notes("ceo", "Asset lost")).length, 1);
      assert.equal((await clearance("ali")).cleared, false, "still blocked until HR or Management decide");
      assert.deepEqual((await clearance("ali")).pendingDecisions.map((p: { tag: string }) => p.tag), [laptop.tag]);
    });

    test("only HR sets a recovery (more than 0); it clears exit and goes to Finance", async () => {
      const incident = (await as("fin").get("/assets/incidents?view=open")).data.find((i: { asset: { tag: string } }) => i.asset.tag === laptop.tag);
      assert.equal((await as("usman").post(`/assets/incidents/${incident.id}/recovery`, { amount: 45000, note: "Depreciated value" })).status, 403);
      assert.equal((await as("fin").post(`/assets/incidents/${incident.id}/recovery`, { amount: 45000, note: "Depreciated value" })).status, 403);
      assert.equal((await as("hr").post(`/assets/incidents/${incident.id}/recovery`, { amount: 0, note: "No charge" })).status, 400, "no-charge needs a Management write-off");
      assert.equal((await as("hr").post(`/assets/incidents/${incident.id}/recovery`, { amount: 45000, note: "Depreciated value" })).status, 200);
      const c = await clearance("ali");
      assert.equal(c.cleared, true);
      assert.equal(c.recoveryTotal, 45000);
      assert.equal((await notes("ali", "Recovery set")).length, 1);
      assert.equal((await notes("fin", "Asset recovery for final settlement")).length, 1);
      assert.ok((await as("fin").get("/assets/incidents?view=recoveries")).data.some((i: { id: number }) => i.id === incident.id));
    });

    test("HR sees the purchase cost and date only on the recovery decision, nowhere else", async () => {
      const incident = (await as("fin").get("/assets/incidents?view=recoveries")).data.find((i: { asset: { tag: string } }) => i.asset.tag === laptop.tag);
      const ctx = await as("hr").get(`/assets/incidents/${incident.id}/recovery-context`);
      assert.equal(ctx.status, 200);
      assert.deepEqual({ cost: ctx.data.purchaseCost, tag: ctx.data.tag }, { cost: 285000, tag: laptop.tag });
      assert.ok("purchaseDate" in ctx.data);
      // still hidden from HR everywhere else
      assert.equal((await as("hr").get(`/assets/${laptop.id}`)).data.cost, undefined);
      assert.equal((await as("hr").get("/assets")).data.find((r: { tag: string }) => r.tag === laptop.tag).cost, undefined);
      // and the context is HR-only, and only while a recovery can be set
      assert.equal((await as("ali").get(`/assets/incidents/${incident.id}/recovery-context`)).status, 403);
      assert.equal((await as("usman").get(`/assets/incidents/${incident.id}/recovery-context`)).status, 403);
      const audited = await prisma.auditLog.findFirst({ where: { action: "VIEW_SENSITIVE", entity: "AssetCost", actorId: id.hr }, orderBy: { id: "desc" } });
      assert.ok(audited, "HR viewing the cost is audited");
    });

    test("only Management writes off; the recovery then no longer applies", async () => {
      const incident = (await as("fin").get("/assets/incidents?view=recoveries")).data.find((i: { asset: { tag: string } }) => i.asset.tag === laptop.tag);
      assert.equal((await as("hr").post(`/assets/incidents/${incident.id}/write-off`, { note: "x y z" })).status, 403);
      assert.equal((await as("ceo").post(`/assets/incidents/${incident.id}/write-off`, { note: "Long-serving employee, theft" })).status, 200);
      const c = await clearance("ali");
      assert.deepEqual({ cleared: c.cleared, recoveryTotal: c.recoveryTotal }, { cleared: true, recoveryTotal: 0 });
    });

    test("Admin records damage directly; a 'not working' report is closed for repair; recorded damage cannot be closed by Admin", async () => {
      const phone = await newAsset(cat.other!, { name: "Samsung A54" });
      await issueTo(phone.id, "sara");
      const recorded = await as("usman").post(`/assets/${phone.id}/incidents`, { type: "DAMAGED", description: "Cracked screen" });
      assert.equal(recorded.status, 201);
      assert.equal((await as("usman").get(`/assets/${phone.id}`)).data.condition, "DAMAGED");
      assert.equal((await as("usman").post(`/assets/incidents/${recorded.data.id}/close`, { note: "fine" })).status, 400);
      const ctx = await as("hr").get(`/assets/incidents/${recorded.data.id}/recovery-context`);
      assert.equal(ctx.status, 200, "available for recorded damage too");

      const mine = (await as("sara").get("/assets/mine")).data.find((m: { asset: { name: string }; returnedAt: string | null }) => m.asset.name === "Samsung A54" && !m.returnedAt);
      const report = await as("sara").post(`/assets/assignments/${mine.id}/report`, { type: "NOT_WORKING", description: "Will not charge" });
      assert.equal((await as("usman").post(`/assets/incidents/${report.data.id}/record`, { type: "NOT_WORKING", note: "Sending for repair" })).status, 200);
      const incidents = (await as("usman").get(`/assets/${phone.id}`)).data.incidents;
      assert.equal(incidents.find((i: { id: number }) => i.id === report.data.id).status, "CLOSED");
    });
  });

  describe("asset requests (Line Manager → Admin)", () => {
    test("approved request: Admin is asked to issue; fulfilled with an item of the right category", async () => {
      const res = await api.call(token.ali!, "POST", "/requests/asset", { categoryId: String(cat.laptop), reason: "My laptop is 6 years old", neededBy: "" });
      assert.equal(res.status, 201, res.data.message);
      const requestId = res.data.id;
      const steps = await prisma.requestStep.findMany({ where: { requestId }, orderBy: { order: "asc" }, include: { approver: true } });
      assert.deepEqual(steps.map((s) => (s.approver ? `${s.label}: ${s.approver.fullName}` : s.label)), ["Line Manager: Hamza Malik", "Admin"]);
      await as("hamza").post(`/requests/${requestId}/approve`);
      await as("usman").post(`/requests/${requestId}/approve`);
      assert.equal((await notes("usman", "Asset to issue")).length, 1);
      assert.ok((await as("usman").get("/assets/requests")).data.some((r: { requestId: number }) => r.requestId === requestId));
      assert.equal((await as("usman").get(`/requests/${requestId}`)).data.canFulfil, true);

      const mouse = await newAsset(cat.accessories!, { name: "Spare mouse" });
      assert.match((await issueTo(mouse.id, "sara", { requestId })).data.message, /different category/);
      const laptop = await newAsset(cat.laptop!, { name: "Dell Latitude 7450" });
      assert.equal((await issueTo(laptop.id, "sara", { requestId })).status, 200, "goes to the requester, not Sara");
      const d = (await as("ali").get(`/requests/${requestId}`)).data;
      assert.equal(d.assetRequest.fulfilled.tag, laptop.tag);
      assert.match((await as("usman").get(`/assets/${laptop.id}`)).data.current.assignee, /Ali Raza/);
      const another = await newAsset(cat.laptop!);
      assert.match((await issueTo(another.id, "ali", { requestId })).data.message, /already been fulfilled/);
      assert.equal((await as("usman").get("/assets/requests")).data.some((r: { requestId: number }) => r.requestId === requestId), false);
    });
  });

  describe("Excel import", () => {
    test("downloads a template", async () => {
      const res = await fetch(`${api.base}/assets/import-template`, { headers: { Authorization: `Bearer ${token.usman}` } });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /spreadsheetml/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await res.arrayBuffer());
      assert.equal(wb.worksheets[0]!.getRow(1).getCell(1).value, "Tag");
      assert.equal((await fetch(`${api.base}/assets/import-template`, { headers: { Authorization: `Bearer ${token.ali}` } })).status, 403);
    });

    test("imports rows: existing or generated tags, assignments, and reports skipped rows", async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Assets");
      ws.addRow(["Tag", "Category", "Name", "Serial number", "Purchase date", "Cost", "Warranty until", "Condition", "Storage location", "Notes", "Assigned to employee", "Assigned to department", "Assigned to location"]);
      ws.addRow(["IMP-LT-1", "Laptop", "HP EliteBook 840", "5CG1", "10/02/2025", 240000, "10/02/2028", "Good", "", "", "EHB-2024-006", "", ""]);
      ws.addRow(["", "Other", "Projector", "PJ-9", "", "", "", "Fair", "Store room", "", "", "Engineering", ""]);
      ws.addRow(["", "Drones", "DJI Mini", "", "", "", "", "", "", "", "", "", ""]);
      ws.addRow(["IMP-LT-1", "Laptop", "Duplicate", "", "", "", "", "", "", "", "", "", ""]);
      ws.addRow(["", "Laptop", "Spare laptop", "", "", "", "", "Excellent", "", "", "", "", ""]);
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      const fd = new FormData();
      fd.append("file", new Blob([buffer]), "register.xlsx");
      const res = await fetch(`${api.base}/assets/import`, { method: "POST", headers: { Authorization: `Bearer ${token.usman}` }, body: fd });
      const data = (await res.json()) as { created: { tag: string; assignedTo: string | null }[]; skipped: { row: number; reason: string }[] };
      assert.equal(res.status, 200);
      assert.equal(data.created.length, 2);
      assert.equal(data.created[0]!.tag, "IMP-LT-1");
      assert.match(data.created[1]!.tag, /^EHB-AST-\d{4}$/);
      assert.deepEqual(data.skipped.map((s) => s.row), [4, 5, 6]);
      assert.match(data.skipped[0]!.reason, /Unknown category "Drones"/);
      assert.match(data.skipped[1]!.reason, /already exists/);
      assert.match(data.skipped[2]!.reason, /Unknown condition/);
      const mine = (await as("ali").get("/assets/mine")).data.find((m: { asset: { tag: string } }) => m.asset.tag === "IMP-LT-1");
      assert.equal(mine.confirmedAt, null, "imported items wait for the employee's confirmation");
      assert.equal((await notes("ali", "Please confirm the items issued to you")).length, 1);
    });
  });

  describe("leaving", () => {
    test("deactivating an employee who still holds items asks Admin to collect them", async () => {
      assert.equal((await clearance("ali")).cleared, false);
      await as("hr").patch(`/employees/${id.ali}`, { status: "INACTIVE" });
      const [n] = await notes("usman", "Collect company items: Ali Raza");
      assert.ok(n);
      assert.match(n!.body, /IMP-LT-1/);
      await as("hr").patch(`/employees/${id.ali}`, { status: "ACTIVE" });
    });
  });
});
