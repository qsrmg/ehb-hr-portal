import { PgBoss } from "pg-boss";
import { env } from "../config/env.js";
import { deliverEmail, type EmailMessage } from "../lib/mailer.js";
import { sendDueReminders } from "./reminders.js";
import { yearEndCarryForward } from "../services/leave.js";
import { deactivateDueExits } from "../services/exits.js";

// Background jobs run on pg-boss, which keeps its queue in the same PostgreSQL database (schema "pgboss").
const EMAIL_QUEUE = "email";
const REMINDER_QUEUE = "approval-reminders";
export const CARRY_FORWARD_QUEUE = "leave-carry-forward";
const EXIT_DEACTIVATION_QUEUE = "exit-deactivation";
/** 00:05 on 1 January, company time. */
export const CARRY_FORWARD_CRON = "5 0 1 1 *";

let boss: PgBoss | null = null;

export type QueueOptions = {
  /** First retry delay for a failed email; doubles on each attempt. */
  retryDelaySeconds?: number;
  pollingIntervalSeconds?: number;
  /** Register the scheduled jobs (reminders, year-end carry forward). Off in most tests, which call them directly. */
  schedules?: boolean;
};

export async function startQueue(opts: QueueOptions = {}) {
  if (boss) return;
  const url = new URL(env.DATABASE_URL);
  url.search = ""; // drop Prisma-only parameters such as ?schema=public
  const instance = new PgBoss({ connectionString: url.toString(), schema: "pgboss", application_name: "hr-portal" });
  instance.on("error", (err: Error) => console.error("[queue]", err.message));
  await instance.start();

  await instance.createQueue(EMAIL_QUEUE, { retryLimit: 5, retryDelay: opts.retryDelaySeconds ?? 30, retryBackoff: true });
  await instance.work<EmailMessage>(EMAIL_QUEUE, { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2 }, async (jobs) => {
    for (const job of jobs) await deliverEmail(job.data);
  });

  if (opts.schedules !== false) {
    // Checks every 10 minutes; sendDueReminders itself enforces office hours and the 3-hour interval.
    await instance.createQueue(REMINDER_QUEUE);
    await instance.schedule(REMINDER_QUEUE, "*/10 * * * *", null, { tz: env.APP_TIMEZONE });
    await instance.work(REMINDER_QUEUE, async () => {
      const sent = await sendDueReminders();
      if (sent) console.log(`[reminders] queued ${sent} reminder(s)`);
    });

    // If the server was down at midnight on 1 January, "once" runs the missed carry forward when it is back.
    await instance.createQueue(CARRY_FORWARD_QUEUE, { retryLimit: 3, retryDelay: 300 });
    await instance.schedule(CARRY_FORWARD_QUEUE, CARRY_FORWARD_CRON, null, { tz: env.APP_TIMEZONE, missed: "once" });
    await instance.work(CARRY_FORWARD_QUEUE, async () => {
      const { fromYear, updated } = await yearEndCarryForward();
      console.log(`[carry-forward] carried ${fromYear} into ${fromYear + 1}: ${updated} balances`);
    });

    // Every hour: logins of leavers whose last working day has ended are switched off.
    await instance.createQueue(EXIT_DEACTIVATION_QUEUE);
    await instance.schedule(EXIT_DEACTIVATION_QUEUE, "5 * * * *", null, { tz: env.APP_TIMEZONE });
    await instance.work(EXIT_DEACTIVATION_QUEUE, async () => {
      const count = await deactivateDueExits();
      if (count) console.log(`[exits] deactivated ${count} account(s) after their last working day`);
    });
  }
  boss = instance;
}

export async function stopQueue() {
  if (!boss) return;
  const instance = boss;
  boss = null;
  await instance.stop({ graceful: true, timeout: 5000 });
}

/**
 * Puts an email on the queue. Scripts that run without the queue (seed, one-off tools) send it directly.
 */
export async function enqueueEmail(msg: EmailMessage) {
  if (boss) {
    await boss.send(EMAIL_QUEUE, msg);
    return;
  }
  try {
    await deliverEmail(msg);
  } catch (err) {
    console.error(`[email] failed to send to ${msg.to}: ${(err as Error).message}`);
  }
}
