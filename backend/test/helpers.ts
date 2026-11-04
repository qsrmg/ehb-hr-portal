import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { setMailTransport } from "../src/lib/mailer.js";
import { addDays, isWeekend, todayYmd, toDate, ymd } from "../src/lib/dates.js";

export type SentEmail = { to: string; subject: string; text: string; html: string };

/** Emails delivered by the queue end up here instead of a mail server. */
export const outbox: SentEmail[] = [];
let failuresToSimulate = 0;

export function useMemoryTransport() {
  outbox.length = 0;
  setMailTransport(
    nodemailer.createTransport({
      name: "memory",
      version: "1",
      send(mail, callback) {
        if (failuresToSimulate > 0) {
          failuresToSimulate--;
          return callback(new Error("Simulated SMTP outage"), undefined as never);
        }
        const d = mail.data;
        outbox.push({ to: String(d.to), subject: String(d.subject), text: String(d.text), html: String(d.html) });
        callback(null, { envelope: mail.message.getEnvelope(), messageId: `${Date.now()}@test` } as never);
      },
    }),
  );
}

export const failNextDeliveries = (n: number) => { failuresToSimulate = n; };

/** Waits until the queue has delivered emails matching the predicate. */
export async function waitForEmails(predicate: (sent: SentEmail[]) => boolean, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate(outbox)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for emails. Outbox:\n${outbox.map((e) => `  ${e.to}: ${e.subject}`).join("\n") || "  (empty)"}`);
}

/** Emails sent to one address whose subject starts with a prefix. */
export const sentTo = (to: string, subjectPrefix: string) => outbox.filter((e) => e.to === to && e.subject.startsWith(subjectPrefix));

export async function resetDatabase() {
  if (!process.env.DATABASE_URL?.includes("/hr_ms_test")) throw new Error("Refusing to reset a non-test database");
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  // Drop jobs left over from earlier runs so they cannot deliver into this run's outbox.
  await prisma.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN TRUNCATE pgboss.job; END IF; END $$`);
}

export const PASSWORD = "Password@123";

/** Employee (Ali) reports to a line manager (Hamza); one HR user (Ayesha). */
export async function seedPeople() {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const dept = await prisma.department.create({ data: { name: "Engineering" } });
  const base = { passwordHash, mustChangePassword: false, joiningDate: toDate("2024-01-01"), departmentId: dept.id };
  const hr = await prisma.employee.create({ data: { ...base, code: "EHB-2024-001", email: "hr@test.local", fullName: "Ayesha Siddiqui", roles: ["EMPLOYEE", "HR"] } });
  const manager = await prisma.employee.create({ data: { ...base, code: "EHB-2024-002", email: "manager@test.local", fullName: "Hamza Malik", roles: ["EMPLOYEE", "LINE_MANAGER"] } });
  const employee = await prisma.employee.create({ data: { ...base, code: "EHB-2024-003", email: "employee@test.local", fullName: "Ali Raza", roles: ["EMPLOYEE"], managerId: manager.id } });
  // One-step chain (Line Manager) and two-step chain (Line Manager -> HR); no notice period so any future date works.
  const casual = await prisma.leaveType.create({ data: { code: "CL", name: "Casual Leave", annualQuota: 10 } });
  const unpaid = await prisma.leaveType.create({ data: { code: "LWP", name: "Leave Without Pay", annualQuota: null, paid: false, needsHrApproval: true, proRata: false } });
  return { hr, manager, employee, casual, unpaid };
}

/** The n-th working day from today (skips weekends). */
export function futureWorkday(n: number) {
  let d = toDate(todayYmd());
  let count = 0;
  while (count < n) {
    d = addDays(d, 1);
    if (!isWeekend(d)) count++;
  }
  return ymd(d);
}

export async function startServer() {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  async function call(token: string | null, method: string, path: string, body?: Record<string, unknown>) {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    let payload: BodyInit | undefined;
    if (body && method !== "GET") {
      // Request forms are multipart (they can carry attachments); everything else is JSON, as in the frontend.
      if (/^\/requests\/(leave|letter|attendance-update)$|\/resubmit$/.test(path)) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(body)) fd.append(k, String(v));
        payload = fd;
      } else {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
    }
    const res = await fetch(base + path, { method, headers, body: payload });
    return { status: res.status, data: await res.json() };
  }

  async function login(email: string) {
    const res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    return ((await res.json()) as { token: string }).token;
  }

  return { base, call, login, close: () => new Promise<void>((r) => server.close(() => r())) };
}
