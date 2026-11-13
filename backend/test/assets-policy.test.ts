import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { toDate, todayYmd } from "../src/lib/dates.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

/**
 * Employee Assets Management Policy (effective 5 October 2026) and Cyber Security Incident Response
 * Policy (v1.0, effective 5 October 2026) alignment. Each describe block is named after the clause it
 * proves. backend/test/assets.test.ts covers the pre-existing behaviour these build on.
 */
describe("Employee Assets Management Policy alignment", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};
  const cat: Record<string, number> = {};

  const as = (who: string) => ({
    get: (path: string) => api.call(token[who]!, "GET", path),
    post: (path: string, body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", path, body),
  });
  const ok = (res: { status: number; data: { message?: string } }, status = 200) => assert.equal(res.status, status, res.data.message ?? JSON.stringify(res.data));
  const forbidden = (res: { status: number }) => assert.equal(res.status, 403);
  const setSetting = (key: string, value: string) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const notes = (who: string, prefix: string) => prisma.notification.findMany({ where: { employeeId: id[who], title: { startsWith: prefix } } });

  const newAsset = async (categoryId: number, extra: Record<string, unknown> = {}) => {
    const res = await as("usman").post("/assets", { categoryId, name: "Dell Latitude 5440", serialNumber: "SN-" + Math.random().toString(36).slice(2, 8), cost: 285000, ...extra });
    assert.equal(res.status, 201, res.data.message);
    return res.data as { id: number; tag: string };
  };
  const issueTo = (assetId: number, employee: string, extra: Record<string, unknown> = {}) =>
    as("usman").post(`/assets/${assetId}/issue`, { assigneeType: "EMPLOYEE", employeeId: id[employee], ...extra });

  /**
   * PDFKit compresses its content streams (FlateDecode) and shows text with TJ/Tj operators using
   * hex-encoded strings for kerned runs. This decompresses every stream, then decodes the text-showing
   * operators back to plain text so a substring search works. Built on node:zlib only (no new dependency).
   */
  function pdfText(buffer: Buffer) {
    const raw = buffer.toString("latin1");
    const streams: string[] = [];
    const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let m: RegExpExecArray | null;
    while ((m = streamRe.exec(raw))) {
      try {
        streams.push(zlib.inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1"));
      } catch {
        /* not a flate stream */
      }
    }
    const content = streams.join("\n");
    let text = "";
    const tjArray = /\[((?:<[0-9a-fA-F]+>|\([^)]*\)|[-\d.]+)\s*)+\]\s*TJ/g;
    let mm: RegExpExecArray | null;
    while ((mm = tjArray.exec(content))) {
      const hexRe = /<([0-9a-fA-F]+)>/g;
      let h: RegExpExecArray | null;
      while ((h = hexRe.exec(mm[0]))) text += Buffer.from(h[1]!, "hex").toString("latin1");
      text += " ";
    }
    const tj = /\(([^)]*)\)\s*Tj/g;
    let tt: RegExpExecArray | null;
    while ((tt = tj.exec(content))) text += tt[1] + " ";
    return text;
  }

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const mgmt = await prisma.department.create({ data: { name: "Management" } });
    const eng = await prisma.department.create({ data: { name: "Engineering" } });
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
    await person("zara", "Zara Ahmed", eng.id, [], id.hamza!); // kept free of assets until the A10/A14 tests
    cat.laptop = (await prisma.assetCategory.create({ data: { name: "Laptop", sortOrder: 1, dataBearing: true } })).id;
    cat.furniture = (await prisma.assetCategory.create({ data: { name: "Furniture", sortOrder: 2, dataBearing: false } })).id;
    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  describe("A3: Asset Handover / Acknowledgement Form", () => {
    test("contains the employee, tag, serial, condition and accessories, never the cost", async () => {
      const asset = await newAsset(cat.laptop!, { name: "ThinkPad T14", serialNumber: "TP-9001" });
      ok(await as("usman").post(`/assets/${asset.id}/issue`, {
        assigneeType: "EMPLOYEE", employeeId: id.ali, condition: "GOOD", accessories: [{ name: "Charger" }, { name: "Dock", quantity: 2 }],
      }));
      const mine = (await as("ali").get("/assets/mine")).data.find((m: { asset: { tag: string } }) => m.asset.tag === asset.tag);

      const res = await fetch(`${api.base}/assets/assignments/${mine.id}/handover`, { headers: { Authorization: `Bearer ${token.usman}` } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/pdf");
      const text = pdfText(Buffer.from(await res.arrayBuffer()));
      for (const expected of ["Ali Raza", asset.tag, "ThinkPad T14", "TP-9001", "Charger", "Dock"]) assert.ok(text.includes(expected), `expected the handover form to include "${expected}"`);
      assert.ok(!text.includes("285000"), "the cost never appears on the handover form");

      // The employee themselves, and Admin, can fetch it; an unrelated employee cannot.
      assert.equal((await fetch(`${api.base}/assets/assignments/${mine.id}/handover`, { headers: { Authorization: `Bearer ${token.ali}` } })).status, 200);
      assert.equal((await fetch(`${api.base}/assets/assignments/${mine.id}/handover`, { headers: { Authorization: `Bearer ${token.sara}` } })).status, 403);
    });
  });

  describe("A9: transfer authorisation", () => {
    test("requires an authorisation note, and the receiving employee's confirmation", async () => {
      const asset = await newAsset(cat.laptop!, { name: "Spare laptop" });
      await issueTo(asset.id, "ali");
      assert.equal((await as("usman").post(`/assets/${asset.id}/transfer`, { assigneeType: "EMPLOYEE", employeeId: id.sara })).status, 400);
      ok(await as("usman").post(`/assets/${asset.id}/transfer`, { assigneeType: "EMPLOYEE", employeeId: id.sara, authorisationNote: "Ali is leaving the project" }));
      const d = (await as("usman").get(`/assets/${asset.id}`)).data;
      assert.equal(d.current.confirmedAt, null, "the receiving employee has not confirmed yet");
      ok(await as("sara").post(`/assets/assignments/${d.current.id}/confirm`));
    });

    test("the authorising role is per category; empty means Admin", async () => {
      await prisma.assetCategory.update({ where: { id: cat.furniture! }, data: { transferAuthorisingRole: "HR" } });
      const chair = await newAsset(cat.furniture!, { name: "Office chair" });
      await issueTo(chair.id, "ali");
      forbidden(await as("usman").post(`/assets/${chair.id}/transfer`, { assigneeType: "EMPLOYEE", employeeId: id.sara, authorisationNote: "Reassigned" }));
      ok(await as("hr").post(`/assets/${chair.id}/transfer`, { assigneeType: "EMPLOYEE", employeeId: id.sara, authorisationNote: "Reassigned" }));
      await prisma.assetCategory.update({ where: { id: cat.furniture! }, data: { transferAuthorisingRole: null } });
    });
  });

  describe("A6: employee loss/theft/damage report, and the Cyber Security Incident Response Policy", () => {
    test("notifies the Line Manager and Admin at once; a non-data-bearing item does not notify IT/Security", async () => {
      const chair = await newAsset(cat.furniture!, { name: "Office chair" });
      await issueTo(chair.id, "ali");
      const mine = (await as("ali").get("/assets/mine")).data.find((m: { asset: { tag: string } }) => m.asset.tag === chair.tag);
      ok(await as("ali").post(`/assets/assignments/${mine.id}/report`, { type: "DAMAGED", description: "Leg snapped" }), 201);
      assert.equal((await notes("usman", "Problem reported")).length, 1, "Admin is told");
      assert.equal((await notes("hamza", "Problem reported")).length, 1, "the Line Manager is told");
      assert.equal((await notes("hr", "Data-bearing asset")).length, 0, "furniture is not data-bearing");
    });

    test("a data-bearing asset also notifies the role in the setting, without the employee's own description; empty setting sends nothing", async () => {
      const laptop = await newAsset(cat.laptop!, { name: "Dell XPS" });
      await issueTo(laptop.id, "ali");
      const mine1 = (await as("ali").get("/assets/mine")).data.find((m: { asset: { tag: string } }) => m.asset.tag === laptop.tag);
      ok(await as("ali").post(`/assets/assignments/${mine1.id}/report`, { type: "LOST", description: "Left it on a very specific and identifying train seat" }), 201);
      assert.equal((await notes("hr", "Data-bearing asset")).length, 0, "the setting is empty by default, so no extra notification");

      await setSetting("assets.cyberSecurityNotifyRole", "HR");
      const laptop2 = await newAsset(cat.laptop!, { name: "Dell XPS 2" });
      await issueTo(laptop2.id, "ali");
      const mine2 = (await as("ali").get("/assets/mine")).data.find((m: { asset: { tag: string } }) => m.asset.tag === laptop2.tag);
      ok(await as("ali").post(`/assets/assignments/${mine2.id}/report`, { type: "LOST", description: "A very specific description that must not leak" }), 201);
      const cyberNotes = await notes("hr", "Data-bearing asset");
      assert.equal(cyberNotes.length, 1);
      assert.ok(!cyberNotes[0]!.body.includes("A very specific description"), "the employee's own description is never included");
      assert.match(cyberNotes[0]!.body, /handled outside the portal/);
      await setSetting("assets.cyberSecurityNotifyRole", "");
    });

    test("a police report attachment is visible to the employee, Admin, HR and Management, never Finance or the Line Manager", async () => {
      const laptop = await newAsset(cat.laptop!, { name: "Dell XPS 3" });
      await issueTo(laptop.id, "ali");
      const mine = (await as("ali").get("/assets/mine")).data.find((m: { asset: { tag: string } }) => m.asset.tag === laptop.tag);
      const report = await as("ali").post(`/assets/assignments/${mine.id}/report`, { type: "LOST", description: "Stolen from car" });
      const incidentId = report.data.id as number;
      await as("usman").post(`/assets/incidents/${incidentId}/record`, { type: "LOST" });

      const fd = new FormData();
      fd.append("file", new Blob(["%PDF-1.4 police report"], { type: "application/pdf" }), "police-report.pdf");
      const up = await fetch(`${api.base}/assets/incidents/${incidentId}/attachment`, { method: "POST", headers: { Authorization: `Bearer ${token.hr}` }, body: fd });
      assert.equal(up.status, 200);

      for (const who of ["ali", "usman", "hr", "ceo"]) assert.equal((await fetch(`${api.base}/assets/incidents/${incidentId}/attachment`, { headers: { Authorization: `Bearer ${token[who]}` } })).status, 200, who);
      for (const who of ["fin", "hamza"]) assert.equal((await fetch(`${api.base}/assets/incidents/${incidentId}/attachment`, { headers: { Authorization: `Bearer ${token[who]}` } })).status, 403, who);

      const inList = (await as("usman").get("/assets/incidents?view=open")).data.find((i: { id: number }) => i.id === incidentId);
      assert.equal(inList.hasAttachment, true);
    });

    test("the police-report-required-types setting is advisory and works empty and filled", async () => {
      const laptop = await newAsset(cat.laptop!, { name: "Dell XPS 4" });
      await issueTo(laptop.id, "ali");
      const mine = (await as("ali").get("/assets/mine")).data.find((m: { asset: { tag: string } }) => m.asset.tag === laptop.tag);
      const report = await as("ali").post(`/assets/assignments/${mine.id}/report`, { type: "LOST", description: "Lost it somewhere" });
      ok(report, 201);
      let detail = (await as("usman").get(`/assets/${laptop.id}`)).data;
      assert.equal(detail.incidents[0].policeReportSuggested, false, "empty setting: nothing is suggested");

      await setSetting("assets.policeReportRequiredTypes", "LOST, DAMAGED");
      detail = (await as("usman").get(`/assets/${laptop.id}`)).data;
      assert.equal(detail.incidents[0].policeReportSuggested, true);
      // Still never blocking: Admin can record it with no attachment at all.
      ok(await as("usman").post(`/assets/incidents/${report.data.id}/record`, { type: "LOST" }));
      await setSetting("assets.policeReportRequiredTypes", "");
    });
  });

  describe("A6: recovery findings, including wear and tear, and the Management-approval threshold", () => {
    test("a finding is required, and WEAR_AND_TEAR closes the report with no recovery", async () => {
      const laptop = await newAsset(cat.laptop!, { name: "Dell XPS 5" });
      await issueTo(laptop.id, "ali");
      const recorded = await as("usman").post(`/assets/${laptop.id}/incidents`, { type: "DAMAGED", description: "Hinge cracked" });
      const incidentId = recorded.data.id as number;
      assert.equal((await as("hr").post(`/assets/incidents/${incidentId}/recovery`, { amount: 5000, note: "x" })).status, 400, "finding is required");
      ok(await as("hr").post(`/assets/incidents/${incidentId}/recovery`, { finding: "WEAR_AND_TEAR", note: "Normal wear after three years" }));
      const detail = (await as("usman").get(`/assets/${laptop.id}`)).data;
      const incident = detail.incidents.find((i: { id: number }) => i.id === incidentId);
      assert.equal(incident.status, "CLOSED");
      assert.equal(incident.recoveryAmount, null);
      assert.equal((await notes("ali", "No recovery")).length, 1);
    });

    test("empty threshold: HR's recovery is final immediately", async () => {
      const laptop = await newAsset(cat.laptop!, { name: "Dell XPS 6" });
      await issueTo(laptop.id, "ali");
      const recorded = await as("usman").post(`/assets/${laptop.id}/incidents`, { type: "DAMAGED", description: "Cracked screen" });
      const incidentId = recorded.data.id as number;
      const res = await as("hr").post(`/assets/incidents/${incidentId}/recovery`, { finding: "NEGLIGENCE", amount: 20000, note: "Dropped" });
      assert.equal(res.data.needsApproval, false);
      const detail = (await as("usman").get(`/assets/${laptop.id}`)).data;
      assert.equal(detail.incidents.find((i: { id: number }) => i.id === incidentId).status, "RECOVERY_SET");
      assert.ok((await notes("fin", "Asset recovery for final settlement")).some((n) => n.body.includes(laptop.tag)));
    });

    test("filled threshold: a recovery above it waits for Management, then notifies the employee and Finance", async () => {
      await setSetting("assets.recoveryApprovalThreshold", "50000");
      // A fresh holder (sara), so the notification counts below are not polluted by the previous test's recovery on ali.
      const laptop = await newAsset(cat.laptop!, { name: "Dell XPS 7" });
      await issueTo(laptop.id, "sara");
      const recorded = await as("usman").post(`/assets/${laptop.id}/incidents`, { type: "DAMAGED", description: "Screen smashed" });
      const incidentId = recorded.data.id as number;
      const res = await as("hr").post(`/assets/incidents/${incidentId}/recovery`, { finding: "NEGLIGENCE", amount: 80000, note: "Full replacement cost" });
      assert.equal(res.data.needsApproval, true);
      assert.equal((await notes("sara", "Recovery set")).length, 0, "not final yet");
      assert.ok((await notes("ceo", "Recovery awaiting approval")).some((n) => n.body.includes(laptop.tag)));

      forbidden(await as("hr").post(`/assets/incidents/${incidentId}/recovery/approve`));
      ok(await as("ceo").post(`/assets/incidents/${incidentId}/recovery/approve`));
      assert.equal((await notes("sara", "Recovery set")).length, 1);
      assert.ok((await notes("fin", "Asset recovery for final settlement")).some((n) => n.body.includes(laptop.tag)));
      const detail = (await as("usman").get(`/assets/${laptop.id}`)).data;
      assert.equal(detail.incidents.find((i: { id: number }) => i.id === incidentId).status, "RECOVERY_SET");
      await setSetting("assets.recoveryApprovalThreshold", "");
    });
  });

  describe("A11/A13: accessories checked at return", () => {
    test("missing accessories are shown on the return screen", async () => {
      const laptop = await newAsset(cat.laptop!, { name: "Dell XPS 8" });
      await as("usman").post(`/assets/${laptop.id}/issue`, { assigneeType: "EMPLOYEE", employeeId: id.ali, accessories: [{ name: "Charger" }, { name: "Mouse", quantity: 2 }] });
      const detail = (await as("usman").get(`/assets/${laptop.id}`)).data;
      const accessories = detail.current.accessories as { id: number; name: string }[];
      assert.equal(accessories.length, 2);
      const charger = accessories.find((a) => a.name === "Charger")!;
      const mouse = accessories.find((a) => a.name === "Mouse")!;
      const res = await as("usman").post(`/assets/${laptop.id}/return`, { accessories: [{ id: charger.id, returned: true }, { id: mouse.id, returned: false }] });
      assert.deepEqual(res.data.missingAccessories.map((a: { name: string }) => a.name), ["Mouse"]);
    });
  });

  describe("A13: disposal and replacement status", () => {
    test("retiring requires a disposal reason; REPLACED requires the replacing tag", async () => {
      const laptop = await newAsset(cat.laptop!, { name: "Old laptop" });
      assert.equal((await as("usman").post(`/assets/${laptop.id}/retire`, { note: "Beyond repair" })).status, 400, "disposalReason is required");
      assert.equal((await as("usman").post(`/assets/${laptop.id}/retire`, { note: "Upgraded", disposalReason: "REPLACED" })).status, 400, "REPLACED needs a tag");
      ok(await as("usman").post(`/assets/${laptop.id}/retire`, { note: "Upgraded", disposalReason: "REPLACED", replacedByTag: "EHB-AST-0099" }));
      const d = (await as("usman").get(`/assets/${laptop.id}`)).data;
      assert.equal(d.disposalReason, "REPLACED");
      assert.ok(d.disposalDate);
      assert.match(d.notes, /EHB-AST-0099/);
    });
  });

  describe("A13: asset verification round", () => {
    test("Admin opens a round; the holder confirms or flags a discrepancy; it never blocks login", async () => {
      const laptop = await newAsset(cat.laptop!, { name: "Audited laptop" });
      await issueTo(laptop.id, "ali");
      const round = await as("usman").post("/assets/verification-rounds", { scope: "ALL", dueDate: "2027-01-31" });
      assert.equal(round.status, 201);
      assert.ok(round.data.items >= 1);
      assert.equal((await notes("ali", "Please confirm your company items")).length, 1);

      const mine = (await as("ali").get("/assets/mine")).data.find((m: { asset: { tag: string } }) => m.asset.tag === laptop.tag);
      assert.ok(mine.pendingVerification);
      assert.equal(mine.pendingVerification.dueDate, "2027-01-31");

      const detail = (await as("usman").get(`/assets/verification-rounds/${round.data.id}`)).data;
      const item = detail.items.find((i: { asset: { tag: string } }) => i.asset.tag === laptop.tag);
      assert.equal(item.confirmedAt, null);
      ok(await as("ali").post(`/assets/verification-items/${item.id}/confirm`, { matches: false, note: "Screen is cracked now" }));

      const after = (await as("usman").get(`/assets/verification-rounds/${round.data.id}`)).data;
      const confirmed = after.items.find((i: { asset: { tag: string } }) => i.asset.tag === laptop.tag);
      assert.ok(confirmed.confirmedAt);
      assert.equal(confirmed.discrepancyNote, "Screen is cracked now");

      const list = (await as("usman").get("/assets/verification-rounds")).data;
      const row = list.find((r: { id: number }) => r.id === round.data.id);
      assert.equal(row.discrepancies, 1);

      ok(await as("usman").post(`/assets/verification-rounds/${round.data.id}/close`));
      const stillLoggedIn = await as("ali").get("/assets/mine");
      assert.equal(stillLoggedIn.status, 200, "closing a round never blocks login or anything else");
    });

    test("the reminder setting is empty by default (off), and works once filled", async () => {
      // The previous test opened a round just now (real time); these checks are relative to that.
      const { notifyAssetVerificationDue } = await import("../src/services/assets.js");
      const soon = toDate(todayYmd());
      const in3Months = `${new Date(Date.UTC(soon.getUTCFullYear(), soon.getUTCMonth() + 3, soon.getUTCDate())).toISOString().slice(0, 10)}`;
      const in7Months = `${new Date(Date.UTC(soon.getUTCFullYear(), soon.getUTCMonth() + 7, soon.getUTCDate())).toISOString().slice(0, 10)}`;
      const in7MonthsPlus1Day = `${new Date(Date.UTC(soon.getUTCFullYear(), soon.getUTCMonth() + 7, soon.getUTCDate() + 1)).toISOString().slice(0, 10)}`;
      assert.equal(await notifyAssetVerificationDue(in7Months), 0, "no setting: never reminds");
      await setSetting("assets.auditReminderMonths", "6");
      assert.equal(await notifyAssetVerificationDue(in3Months), 0, "only 3 of the 6 months have passed: not yet due");
      assert.equal(await notifyAssetVerificationDue(in7Months), 1, "7 months on: due");
      assert.equal((await notes("usman", "Asset verification round due")).length, 1);
      assert.equal(await notifyAssetVerificationDue(in7MonthsPlus1Day), 0, "reminded once this calendar month already");
      await setSetting("assets.auditReminderMonths", "");
    });
  });

  describe("A10/A14: clearance blocked by outstanding assets, and the Management override", () => {
    test("a retained item no longer blocks exit clearance", async () => {
      // zara holds nothing else in this file, so her clearance reflects only this one item.
      const laptop = await newAsset(cat.laptop!, { name: "Retained laptop" });
      await issueTo(laptop.id, "zara");
      let clearance = (await as("hr").get(`/assets/clearance/${id.zara}`)).data;
      assert.equal(clearance.cleared, false);
      assert.deepEqual(clearance.outstanding.map((o: { tag: string }) => o.tag), [laptop.tag]);

      const current = (await as("usman").get(`/assets/${laptop.id}`)).data.current;
      forbidden(await as("usman").post(`/assets/assignments/${current.id}/retain`, { note: "Approved" }));
      ok(await as("ceo").post(`/assets/assignments/${current.id}/retain`, { note: "Approved for continued use at home while consulting" }));

      clearance = (await as("hr").get(`/assets/clearance/${id.zara}`)).data;
      assert.equal(clearance.cleared, true);
      assert.deepEqual(clearance.outstanding, []);
      assert.ok(clearance.retained.some((r: { tag: string }) => r.tag === laptop.tag));
      assert.equal((await notes("zara", "Retained with authorisation")).length, 1);
    });

    test("recovery amounts and the retain action are hidden from the Line Manager", async () => {
      const laptop = await newAsset(cat.laptop!, { name: "Team laptop" });
      await issueTo(laptop.id, "zara");
      const recorded = await as("usman").post(`/assets/${laptop.id}/incidents`, { type: "DAMAGED", description: "Screen cracked" });
      ok(await as("hr").post(`/assets/incidents/${recorded.data.id}/recovery`, { finding: "NEGLIGENCE", amount: 15000, note: "Dropped at the office" }));

      // HR (and Admin/Finance/Management) see the real recovery amount through this same endpoint.
      const hrView = (await as("hr").get(`/assets/clearance/${id.zara}`)).data;
      assert.ok(hrView.recoveries.some((r: { tag: string; amount: number }) => r.tag === laptop.tag && r.amount === 15000));
      assert.equal(hrView.recoveryTotal, 15000);

      // The Line Manager queries the exact same endpoint, but never sees the money — not merely absent
      // because there was nothing to show, but filtered out despite a real recovery existing for HR above.
      const mgrView = (await as("hamza").get(`/assets/clearance/${id.zara}`)).data;
      assert.equal(mgrView.recoveries, undefined);
      assert.equal(mgrView.recoveryTotal, undefined);

      const current = (await as("usman").get(`/assets/${laptop.id}`)).data.current;
      assert.equal((await as("hamza").post(`/assets/assignments/${current.id}/retain`, { note: "x" })).status, 403);
    });
  });
});
