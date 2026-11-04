import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { addDays, isWeekend, toDate, todayYmd, ymd } from "../src/lib/dates.js";
import { PASSWORD, resetDatabase, startServer, useMemoryTransport } from "./helpers.js";

type Fields = Record<string, string | number | boolean>;
type SettleLine = { kind?: string; date: string; categoryId?: number; description: string; amount?: number; quantity?: number; noReceiptExplanation?: string; keepReceiptId?: number };

const day = (n: number) => ymd(addDays(toDate(todayYmd()), n));

describe("travel", () => {
  let api: Awaited<ReturnType<typeof startServer>>;
  const token: Record<string, string> = {};
  const id: Record<string, number> = {};
  const cat: Record<string, number> = {};
  let slot = 0; // each trip gets its own future dates so trips never overlap

  const multipart = (fields: Fields, files: Record<string, string> = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    for (const [field, name] of Object.entries(files)) fd.append(field, new Blob(["%PDF-1.4 file"], { type: "application/pdf" }), name);
    return fd;
  };
  const send = async (who: string, method: string, path: string, fd: FormData) => {
    const res = await fetch(`${api.base}${path}`, { method, headers: { Authorization: `Bearer ${token[who]}` }, body: fd });
    return { status: res.status, data: (await res.json()) as Record<string, unknown> & { id: number; message: string } };
  };

  /** Submits a travel request with sensible defaults. */
  async function requestTrip(who: string, over: Fields = {}) {
    const start = 10 + slot * 6;
    slot++;
    return send(who, "POST", "/requests/travel", multipart({
      purpose: "Client workshop", origin: "Lahore", destination: "Karachi", departDate: day(start), returnDate: day(start + 2),
      mode: "AIR", needsHotel: true, estimateTransport: 30000, estimateHotel: 20000, estimateMeals: 6000, estimateOther: 0, advanceRequested: 0, ...over,
    }));
  }
  const ok = async (p: Promise<{ status: number; data: { id: number; message: string } }>) => {
    const r = await p;
    assert.ok(r.status < 300, `${r.status} ${r.data.message}`);
    return r.data.id;
  };
  const act = (who: string, requestId: number, action = "approve", body: Record<string, unknown> = {}) => api.call(token[who]!, "POST", `/requests/${requestId}/${action}`, body);
  const chain = async (requestId: number) =>
    (await prisma.requestStep.findMany({ where: { requestId }, orderBy: { order: "asc" }, include: { approver: true } })).map((s) => (s.approver ? `${s.label}: ${s.approver.fullName}` : s.label));
  const detail = async (who: string, requestId: number) => (await api.call(token[who]!, "GET", `/requests/${requestId}`)).data;
  const setSetting = (key: string, value: string) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const notes = async (employeeId: number, prefix: string) => prisma.notification.findMany({ where: { employeeId, title: { startsWith: prefix } } });

  /** Omar's trip approved by Zara (line manager) and Hamza (HOD), plus Nadia for Finance when an advance is asked. */
  async function approvedTrip(who = "omar", over: Fields = {}) {
    const requestId = await ok(requestTrip(who, over));
    for (let i = 0; i < 4; i++) {
      const d = await detail(who, requestId);
      if (d.status !== "PENDING") break;
      const step = d.steps.find((s: { status: string }) => s.status === "PENDING");
      const approver = { "Line Manager: Zara Khan": "zara", "Line Manager: Hamza Malik": "hamza", "Line Manager: Imran Qureshi": "ceo", "Head of Department: Hamza Malik": "hamza", Finance: "nadia", Management: "ceo" }[
        (await chain(requestId))[step.order]!
      ];
      assert.ok(approver, `no approver for ${(await chain(requestId))[step.order]}`);
      assert.equal((await act(approver!, requestId)).status, 200);
    }
    assert.equal((await detail(who, requestId)).status, "APPROVED");
    return requestId;
  }
  /** Moves an approved trip into the past: it ended `returnedDaysAgo` days ago and lasted `days` days. */
  const tripInPast = (requestId: number, returnedDaysAgo: number, days = 3) =>
    prisma.travelRequest.update({ where: { requestId }, data: { departDate: toDate(day(-returnedDaysAgo - days + 1)), returnDate: toDate(day(-returnedDaysAgo)) } });
  const tripDates = async (requestId: number) => {
    const t = await prisma.travelRequest.findUniqueOrThrow({ where: { requestId } });
    return { depart: ymd(t.departDate), ret: ymd(t.returnDate) };
  };
  const settle = (who: string, travelRequestId: number, lines: SettleLine[], receipts: number[] = [], resubmitId?: number) =>
    send(who, resubmitId ? "PUT" : "POST", resubmitId ? `/requests/${resubmitId}/resubmit` : "/requests/settlement", multipart(
      { travelRequestId, lines: JSON.stringify(lines) },
      Object.fromEntries(receipts.map((i) => [`receipt_${i}`, `receipt-${i}.pdf`])),
    ));
  const check = (who: string, travelRequestId: number, lines: (SettleLine & { hasReceipt: boolean })[]) =>
    api.call(token[who]!, "POST", "/travel/settlement-check", { travelRequestId, lines } as never);

  before(async () => {
    await resetDatabase();
    useMemoryTransport();
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const dept = async (name: string) => prisma.department.create({ data: { name } });
    const [mgmt, finance, eng, admin] = [await dept("Management"), await dept("Finance"), await dept("Engineering"), await dept("Administration")];
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
    await person("bilal", "Bilal Ahmed", finance.id, ["FINANCE", "HOD"], id.ceo!);
    await person("nadia", "Nadia Shah", finance.id, ["FINANCE"], id.bilal!);
    await person("usman", "Usman Tariq", admin.id, ["ADMIN"], id.ceo!);
    await person("hamza", "Hamza Malik", eng.id, ["LINE_MANAGER", "HOD"], id.ceo!);
    await person("zara", "Zara Khan", eng.id, ["LINE_MANAGER"], id.hamza!);
    await person("omar", "Omar Farooq", eng.id, [], id.zara!);
    await person("ali", "Ali Raza", eng.id, [], id.hamza!);
    await prisma.department.update({ where: { id: eng.id }, data: { hodId: id.hamza } });
    await prisma.department.update({ where: { id: finance.id }, data: { hodId: id.bilal } });
    await prisma.department.update({ where: { id: mgmt.id }, data: { hodId: id.ceo } });

    cat.localTravel = (await prisma.expenseCategory.create({ data: { name: "Local travel", scope: "LOCAL" } })).id;
    cat.fare = (await prisma.expenseCategory.create({ data: { name: "Fare (self-arranged ticket)", scope: "TRAVEL" } })).id;
    cat.transport = (await prisma.expenseCategory.create({ data: { name: "Local transport at destination", scope: "TRAVEL" } })).id;
    cat.meals = (await prisma.expenseCategory.create({ data: { name: "Meals while travelling", scope: "TRAVEL", coveredByPerDiem: true } })).id;

    api = await startServer();
    for (const key of Object.keys(id)) token[key] = await api.login(`${key}@test.local`);
  });

  after(async () => {
    await api.close();
  });

  beforeEach(async () => {
    await prisma.setting.deleteMany({ where: { key: { startsWith: "travel." } } });
  });

  describe("pre-trip request", () => {
    test("Line Manager → HOD (asked once when they are the same person)", async () => {
      assert.deepEqual(await chain(await ok(requestTrip("omar"))), ["Line Manager: Zara Khan", "Head of Department: Hamza Malik"]);
      assert.deepEqual(await chain(await ok(requestTrip("ali"))), ["Line Manager: Hamza Malik"]);
    });

    test("an advance adds a Finance step (separation rule applies)", async () => {
      assert.deepEqual(await chain(await ok(requestTrip("omar", { advanceRequested: 10000 }))), ["Line Manager: Zara Khan", "Head of Department: Hamza Malik", "Finance"]);
      // Nadia reports to Bilal (Finance HOD, asked once as line manager): another Finance user is needed, so Management stands in.
      assert.deepEqual(await chain(await ok(requestTrip("nadia", { advanceRequested: 5000 }))), ["Line Manager: Bilal Ahmed", "Management (in place of Finance)"]);
    });

    test("Management step above the threshold (off by default)", async () => {
      assert.equal((await chain(await ok(requestTrip("omar", { estimateTransport: 900000 })))).includes("Management"), false);
      await setSetting("travel.managementApprovalAbove", "50000");
      assert.deepEqual(await chain(await ok(requestTrip("omar", { advanceRequested: 1000 }))), ["Line Manager: Zara Khan", "Head of Department: Hamza Malik", "Management", "Finance"]);
      assert.deepEqual(await chain(await ok(requestTrip("omar", { estimateTransport: 10000, estimateHotel: 0 }))), ["Line Manager: Zara Khan", "Head of Department: Hamza Malik"]);
    });

    test("validation: domestic only, dates, advance limits, no overlapping trips", async () => {
      assert.match((await requestTrip("omar", { country: "AE", destination: "Dubai" })).data.message, /Only domestic travel/);
      assert.match((await requestTrip("omar", { departDate: day(-1), returnDate: day(1) })).data.message, /departure date is in the past/);
      assert.match((await requestTrip("omar", { departDate: day(5), returnDate: day(4) })).data.message, /return date is before the departure date/);
      assert.match((await requestTrip("omar", { advanceRequested: 60000 })).data.message, /advance cannot be more than the estimated cost \(PKR 56,000\)/);
      await setSetting("travel.maxAdvance", "20000");
      assert.match((await requestTrip("omar", { advanceRequested: 25000 })).data.message, /above the limit of PKR 20,000 per trip/);
      const first = await ok(requestTrip("ali", { departDate: day(200), returnDate: day(203) }));
      assert.match((await requestTrip("ali", { departDate: day(202), returnDate: day(205) })).data.message, new RegExp(`overlap with travel request #${first}`));
    });
  });

  describe("after approval: Admin books, Finance pays the advance", () => {
    test("Admin and Finance are asked to act; the traveller's own Finance colleague is never asked to pay them", async () => {
      const requestId = await approvedTrip("omar", { advanceRequested: 8000 });
      const link = `/requests/${requestId}`;
      const toBook = await prisma.notification.findMany({ where: { link, title: { startsWith: "Travel to book" } } });
      assert.deepEqual(toBook.map((n) => n.employeeId), [id.usman]);
      const toPay = await prisma.notification.findMany({ where: { link, title: { startsWith: "Travel advance to pay" } } });
      assert.deepEqual(toPay.map((n) => n.employeeId).sort(), [id.bilal, id.nadia].sort());
    });

    test("booking: Admin only, after approval; items booked by Admin or 'employee to arrange'; traveller notified", async () => {
      const pending = await ok(requestTrip("omar"));
      const add = (who: string, requestId: number, fields: Fields, voucher = false) =>
        send(who, "POST", `/travel/${requestId}/bookings`, multipart(fields, voucher ? { voucher: "ticket.pdf" } : {}));
      assert.equal((await add("usman", pending, { kind: "AIR", details: "PK-302" })).status, 400, "not approved yet");

      const requestId = await approvedTrip("omar");
      assert.equal((await add("omar", requestId, { kind: "AIR", details: "PK-302" })).status, 403);
      assert.equal((await add("usman", requestId, { kind: "AIR" })).status, 400, "details required");
      assert.equal((await add("usman", requestId, { kind: "AIR", details: "PK-302 LHE→KHI 08:00", provider: "PIA", reference: "X7Y2Q", cost: 28500 }, true)).status, 201);
      assert.equal((await add("usman", requestId, { kind: "HOTEL", arrangedBy: "EMPLOYEE" })).status, 201);
      assert.equal((await api.call(token.usman!, "POST", `/travel/${requestId}/booked`, {})).status, 200);

      const d = await detail("omar", requestId);
      assert.equal(d.travel.bookingStatus, "BOOKED");
      assert.deepEqual(d.travel.bookings.map((b: { kind: string; arrangedBy: string }) => `${b.kind}/${b.arrangedBy}`), ["AIR/ADMIN", "HOTEL/EMPLOYEE"]);
      const [booked] = await notes(id.omar!, "Your travel is booked");
      assert.match(booked!.body, /Air: PK-302 LHE→KHI 08:00 \(booked by Admin\); Hotel: Employee to arrange \(you arrange it and claim it in the settlement\)/);

      const voucher = d.travel.bookings[0].voucher.id;
      for (const [who, status] of [["omar", 200], ["usman", 200], ["ali", 403]] as const) {
        const res = await fetch(`${api.base}/requests/${requestId}/attachments/${voucher}`, { headers: { Authorization: `Bearer ${token[who]}` } });
        assert.equal(res.status, status, who);
      }
    });

    test("advance: any Finance user except the traveller, once, after approval", async () => {
      const pay = (who: string, requestId: number, over: Fields = {}) =>
        api.call(token[who]!, "POST", `/travel/${requestId}/advance-paid`, { paidOn: todayYmd(), method: "BANK_TRANSFER", reference: "IBFT-55", ...over });
      const pending = await ok(requestTrip("bilal", { advanceRequested: 5000 }));
      assert.equal((await pay("nadia", pending)).status, 400, "not approved");

      const requestId = await approvedTrip("bilal", { advanceRequested: 5000 });
      assert.equal((await pay("bilal", requestId)).status, 403, "not your own advance");
      assert.equal((await pay("usman", requestId)).status, 403);
      assert.equal((await pay("nadia", requestId, { method: "WITH_SALARY" })).status, 400);
      assert.equal((await pay("nadia", requestId, { method: "CASH" })).status, 200);
      assert.equal((await pay("nadia", requestId)).status, 400, "already paid");
      const d = await detail("bilal", requestId);
      assert.equal(d.travel.advance.paid.method, "CASH");
      assert.equal(d.travel.advance.paid.paidBy, "Nadia Shah");
      assert.equal((await notes(id.bilal!, "Travel advance paid")).length, 1);
    });
  });

  describe("cancellation", () => {
    test("traveller or line manager cancels; Admin records the fee (company pays); Finance adds a note and records the advance return", async () => {
      const requestId = await approvedTrip("omar", { advanceRequested: 12000 });
      await api.call(token.nadia!, "POST", `/travel/${requestId}/advance-paid`, { paidOn: todayYmd(), method: "BANK_TRANSFER", reference: "IBFT-9" });

      assert.equal((await api.call(token.ali!, "POST", `/travel/${requestId}/cancel`, { reason: "Not mine" })).status, 403);
      assert.equal((await act("omar", requestId, "cancel")).status, 400, "travel uses Cancel trip");
      assert.equal((await api.call(token.zara!, "POST", `/travel/${requestId}/cancel`, { reason: "Client postponed the workshop" })).status, 200);
      assert.equal((await api.call(token.zara!, "POST", `/travel/${requestId}/cancel`, { reason: "Again" })).status, 400);

      const d = await detail("omar", requestId);
      assert.equal(d.status, "CANCELLED");
      assert.equal(d.travel.cancellation.by, "Zara Khan");
      assert.equal(d.travel.advance.due, 12000);
      assert.equal((await notes(id.omar!, "Trip cancelled")).length, 1, "traveller told the manager cancelled");
      assert.equal((await notes(id.usman!, "Trip cancelled")).length, 1, "Admin told");
      assert.equal((await notes(id.nadia!, "Advance to recover")).length, 1, "Finance told");

      assert.equal((await api.call(token.omar!, "POST", `/travel/${requestId}/cancellation-fee`, { fee: 3500 })).status, 403);
      assert.equal((await api.call(token.usman!, "POST", `/travel/${requestId}/cancellation-fee`, { fee: 3500, note: "PIA change fee" })).status, 200);
      assert.equal((await api.call(token.nadia!, "POST", `/travel/${requestId}/finance-note`, { note: "Fee booked to travel cost centre" })).status, 200);

      const ret = (over: Record<string, unknown> = {}) =>
        api.call(token.nadia!, "POST", `/travel/${requestId}/advance-return`, { amount: 12000, method: "SALARY_DEDUCTION", returnedOn: todayYmd(), ...over });
      assert.equal((await ret({ amount: 10000 })).status, 400, "must match the amount due");
      assert.equal((await ret()).status, 200);
      const after = await detail("omar", requestId);
      assert.deepEqual(
        { fee: after.travel.cancellation.fee, feeNote: after.travel.cancellation.feeNote, financeNote: after.travel.cancellation.financeNote, due: after.travel.advance.due, method: after.travel.advance.returned.method },
        { fee: 3500, feeNote: "PIA change fee", financeNote: "Fee booked to travel cost centre", due: 0, method: "SALARY_DEDUCTION" },
      );
    });

    test("the traveller can cancel a pending trip; the waiting approver is told", async () => {
      const requestId = await ok(requestTrip("omar"));
      assert.equal((await api.call(token.omar!, "POST", `/travel/${requestId}/cancel`, { reason: "Meeting moved online" })).status, 200);
      assert.equal((await notes(id.zara!, "Trip cancelled")).length >= 1, true);
      assert.ok((await prisma.requestStep.findMany({ where: { requestId } })).every((s) => s.status === "SKIPPED"));
    });
  });

  describe("attendance", () => {
    test("approved trip days show as On duty / Travel; cancelled trips do not", async () => {
      const trip = await approvedTrip("ali");
      await tripInPast(trip, 1, 4);
      const { depart, ret } = await tripDates(trip);
      type Day = { date: string; status: string; note: string };
      // The trip may cross a month boundary: collect the days of every month it touches.
      const daysOf = async () => {
        const months = [...new Set([depart.slice(0, 7), ret.slice(0, 7)])];
        const res = await Promise.all(months.map((m) => api.call(token.ali!, "GET", `/attendance/me?month=${m}`)));
        return { days: res.flatMap((r) => r.data.days as Day[]), travelCount: res.reduce((s, r) => s + r.data.summary.travel, 0) };
      };
      const before = await daysOf();
      const tripDays = before.days.filter((d) => d.date >= depart && d.date <= ret && !isWeekend(toDate(d.date)));
      assert.ok(tripDays.length > 0);
      assert.ok(tripDays.every((d) => d.status === "TRAVEL" && d.note === "Travel: Karachi"));
      assert.equal(before.travelCount, tripDays.length, "counted in the monthly summary");

      await prisma.travelRequest.update({ where: { requestId: trip }, data: { cancelledAt: new Date() } });
      assert.ok((await daysOf()).days.every((d) => d.status !== "TRAVEL"));
      await prisma.travelRequest.update({ where: { requestId: trip }, data: { cancelledAt: null } });
    });
  });

  describe("settlement", () => {
    let trip: number;
    let dates: { depart: string; ret: string };
    const fare = (over: Partial<SettleLine> = {}): SettleLine => ({ date: dates.depart, categoryId: cat.fare!, description: "Daewoo bus back to Lahore", amount: 4500, ...over });

    beforeEach(async () => {
      trip = await approvedTrip("omar");
      await tripInPast(trip, 2, 3); // a 3-day trip (2 nights) that ended 2 days ago
      dates = await tripDates(trip);
    });

    test("only after return, within 15 days (a setting), by the traveller, once per trip", async () => {
      const future = await approvedTrip("omar");
      assert.match((await settle("omar", future, [fare({ date: (await tripDates(future)).depart })], [0])).data.message, /after you return/);

      await tripInPast(trip, 16);
      dates = await tripDates(trip);
      assert.match((await settle("omar", trip, [fare()], [0])).data.message, /within 15 days of return/);
      await setSetting("travel.settlementDays", "20");
      assert.equal((await settle("ali", trip, [fare()], [0])).status, 400, "not the traveller");
      const first = await ok(settle("omar", trip, [fare()], [0]));
      assert.match((await settle("omar", trip, [fare({ amount: 4600 })], [0])).data.message, new RegExp(`already has a settlement \\(#${first}\\)`));
    });

    test("chain is Line Manager → Finance", async () => {
      assert.deepEqual(await chain(await ok(settle("omar", trip, [fare()], [0]))), ["Line Manager: Zara Khan", "Finance"]);
    });

    test("dates must be during the trip; receipts follow the expense rule; local categories are not allowed", async () => {
      assert.match((await settle("omar", trip, [fare({ date: day(-30) })], [0])).data.message, /must be during the trip/);
      assert.match((await settle("omar", trip, [fare()])).data.message, /attach a receipt/);
      assert.equal((await settle("omar", trip, [fare({ amount: 300, noReceiptExplanation: "Rickshaw" })])).status, 201);
    });

    test("a travel category cannot be claimed as a local expense, and vice versa", async () => {
      const fd = multipart({ purpose: "Local", lines: JSON.stringify([{ date: day(-1), categoryId: cat.fare, description: "Bus ticket", amount: 1000 }]) }, { receipt_0: "r.pdf" });
      assert.match((await send("omar", "POST", "/requests/expense", fd)).data.message, /travel cost; claim it in the trip settlement/);
      assert.match((await settle("omar", trip, [fare({ categoryId: cat.localTravel })], [0])).data.message, /choose a travel category/);
    });

    test("daily allowance: off → meals with receipts; on → days × rate, no meals lines, max trip days", async () => {
      const allowance = { kind: "PER_DIEM", date: dates.depart, description: "Daily allowance", quantity: 3, amount: 1 };
      assert.match((await settle("omar", trip, [allowance])).data.message, /daily allowance is not offered/);
      const meals = { date: dates.depart, categoryId: cat.meals!, description: "Dinner", amount: 2200 };
      const ok1 = await ok(settle("omar", trip, [meals], [0]));
      await act("omar", ok1, "cancel");

      await setSetting("travel.perDiemRate", "2000");
      assert.match((await settle("omar", trip, [meals], [0])).data.message, /covered by the daily allowance/);
      assert.match((await settle("omar", trip, [{ ...allowance, quantity: 4 }])).data.message, /Daily allowance days \(4\) are more than the trip's 3 day/);
      const id2 = await ok(settle("omar", trip, [allowance]));
      const line = (await detail("omar", id2)).expense.lines[0];
      assert.deepEqual({ amount: line.amount, quantity: line.quantity, rate: line.rate, receipt: line.receipt }, { amount: 6000, quantity: 3, rate: 2000, receipt: null });
    });

    test("mileage: km × rate, only when a rate is set", async () => {
      const mileage = { kind: "MILEAGE", date: dates.depart, description: "Lahore → Faisalabad and back", quantity: 360 };
      assert.match((await settle("omar", trip, [mileage])).data.message, /mileage cannot be claimed/);
      await setSetting("travel.mileageRatePerKm", "45");
      const res = await check("omar", trip, [{ ...mileage, hasReceipt: false }]);
      assert.equal(res.data.total, 16200);
      assert.equal(res.data.errors.length, 0);
    });

    test("hotel: limit per night (a setting), no more nights than the trip; warning when Admin booked the hotel", async () => {
      await setSetting("travel.hotelLimitPerNight", "8000");
      const hotel = (amount: number, quantity = 2) => ({ kind: "HOTEL", date: dates.depart, description: "Hotel One, Shahrah-e-Faisal", amount, quantity });
      assert.match((await settle("omar", trip, [hotel(18000)], [0])).data.message, /PKR 18,000 for 2 night\(s\) is above the hotel limit of PKR 8,000 per night/);
      assert.match((await settle("omar", trip, [hotel(9000, 3)], [0])).data.message, /Hotel nights \(3\) are more than the trip's 2 night/);
      await prisma.travelBooking.create({ data: { travelId: (await prisma.travelRequest.findUniqueOrThrow({ where: { requestId: trip } })).id, kind: "HOTEL", arrangedBy: "ADMIN", details: "Avari", createdById: id.usman! } });
      const res = await check("omar", trip, [{ ...hotel(16000), hasReceipt: true }]);
      assert.ok(res.data.warnings.some((w: string) => w.includes("Admin already booked a hotel")));
      assert.equal((await settle("omar", trip, [hotel(16000)], [0])).status, 201, "a warning does not block");
    });
  });

  describe("settlement money: advance, Finance changes, paid step and returns", () => {
    async function settledTrip(advance: number, lines: (dates: { depart: string }) => SettleLine[]) {
      const trip = await approvedTrip("omar", { advanceRequested: advance });
      await api.call(token.nadia!, "POST", `/travel/${trip}/advance-paid`, { paidOn: todayYmd(), method: "BANK_TRANSFER", reference: `ADV-${trip}` });
      await tripInPast(trip, 1, 3);
      const d = await tripDates(trip);
      const ls = lines(d);
      const settlement = await ok(settle("omar", trip, ls, ls.map((_, i) => i)));
      await act("zara", settlement);
      return { trip, settlement };
    }
    const line = (date: string, amount: number): SettleLine => ({ date, categoryId: cat.transport!, description: "Careem rides", amount });

    test("spent more than the advance: Finance pays the difference", async () => {
      const { settlement } = await settledTrip(10000, (d) => [line(d.depart, 9000), line(d.depart, 6000)]);
      assert.equal((await detail("bilal", settlement)).canAdjustLines, true, "Finance (not the approver) may adjust");
      const lineId = (await detail("bilal", settlement)).expense.lines[1].id;
      assert.equal((await api.call(token.bilal!, "POST", `/expenses/claims/${settlement}/lines/${lineId}/adjust`, { action: "REDUCE", amount: 5000, reason: "Fare chart" })).status, 200);
      assert.equal((await act("bilal", settlement)).status, 200);
      const d = await detail("omar", settlement);
      assert.deepEqual({ approved: d.expense.totalApproved, advance: d.settlement.advancePaid, toPay: d.settlement.toPay }, { approved: 14000, advance: 10000, toPay: 4000 });
      assert.equal((await detail("bilal", settlement)).canMarkPaid, true);
      assert.equal((await api.call(token.omar!, "POST", `/expenses/claims/${settlement}/paid`, { paidOn: todayYmd(), method: "BANK_TRANSFER", reference: "X" })).status, 403);
      assert.equal((await api.call(token.bilal!, "POST", `/expenses/claims/${settlement}/paid`, { paidOn: todayYmd(), method: "WITH_SALARY", reference: "Payroll Dec" })).status, 200);
      const [paid] = await notes(id.omar!, "Paid: Travel Settlement");
      assert.match(paid!.body, /PKR 4,000 paid by with salary/);
    });

    test("spent less than the advance: nothing to pay, Finance records the return", async () => {
      const { trip, settlement } = await settledTrip(10000, (d) => [line(d.depart, 6000)]);
      await act("bilal", settlement);
      assert.equal((await detail("bilal", settlement)).canMarkPaid, false);
      assert.match((await api.call(token.bilal!, "POST", `/expenses/claims/${settlement}/paid`, { paidOn: todayYmd(), method: "BANK_TRANSFER", reference: "X" })).data.message, /advance covers this settlement/);

      const returns = await api.call(token.bilal!, "GET", "/travel/trips?view=returns");
      assert.deepEqual(returns.data.filter((t: { requestId: number }) => t.requestId === trip).map((t: { advanceDue: number }) => t.advanceDue), [4000]);
      assert.equal((await detail("bilal", trip)).canRecordAdvanceReturn, true);
      assert.equal((await api.call(token.bilal!, "POST", `/travel/${trip}/advance-return`, { amount: 4000, method: "CASH_OR_BANK", returnedOn: todayYmd(), reference: "Deposit slip 88" })).status, 200);
      assert.equal((await api.call(token.bilal!, "GET", "/travel/trips?view=returns")).data.some((t: { requestId: number }) => t.requestId === trip), false);
    });

    test("a trip with a settlement can no longer be cancelled", async () => {
      const { trip } = await settledTrip(2000, (d) => [line(d.depart, 2500)]);
      assert.match((await api.call(token.omar!, "POST", `/travel/${trip}/cancel`, { reason: "Too late" })).data.message, /has a settlement/);
    });

    test("work lists for Admin and Finance", async () => {
      const toBook = await approvedTrip("ali");
      const list = async (view: string) => ((await api.call(token.usman!, "GET", `/travel/trips?view=${view}`)).data as { requestId: number }[]).map((t) => t.requestId);
      assert.ok((await list("to-book")).includes(toBook));
      const advance = await approvedTrip("ali", { advanceRequested: 3000 });
      const advances = ((await api.call(token.nadia!, "GET", "/travel/trips?view=advances")).data as { requestId: number }[]).map((t) => t.requestId);
      assert.ok(advances.includes(advance));
      assert.equal((await api.call(token.omar!, "GET", "/travel/trips")).status, 403);
    });
  });
});
