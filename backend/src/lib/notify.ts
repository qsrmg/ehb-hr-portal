import { env } from "../config/env.js";
import { prisma } from "./prisma.js";
import { renderEmail } from "./mailer.js";
import { enqueueEmail } from "../jobs/queue.js";
import type { Role } from "../generated/prisma/client.js";

/** In-app notification plus a queued email to each active recipient. */
export async function notify(employeeIds: number[], title: string, body: string, link?: string) {
  const ids = [...new Set(employeeIds)];
  if (!ids.length) return;
  await prisma.notification.createMany({
    data: ids.map((employeeId) => ({ employeeId, title, body, link: link ?? null })),
  });
  const recipients = await prisma.employee.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    select: { email: true },
  });
  const { text, html } = renderEmail(title, body, link ? `${env.APP_URL}${link}` : env.APP_URL);
  for (const { email } of recipients) await enqueueEmail({ to: email, subject: title, text, html });
}

export async function employeeIdsWithRole(role: Role) {
  const rows = await prisma.employee.findMany({
    where: { roles: { has: role }, status: "ACTIVE" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
