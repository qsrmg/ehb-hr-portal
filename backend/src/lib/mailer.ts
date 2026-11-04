import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

/** Attachments travel through the queue as base64 text. */
export type EmailAttachment = { filename: string; content: string; contentType: string };
export type EmailMessage = { to: string; subject: string; text: string; html: string; attachments?: EmailAttachment[] };

let transport: Transporter | null = null;
let logToConsole = false;

/** SMTP when SMTP_HOST is set (Mailpit in development), otherwise emails are only logged to the console. */
function defaultTransport(): Transporter {
  if (env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
    });
  }
  logToConsole = true;
  return nodemailer.createTransport({ jsonTransport: true });
}

/** Tests swap in an in-memory transport. */
export function setMailTransport(t: Transporter | null) {
  transport = t;
  logToConsole = false;
}

/** Sends one email now. Throws on failure so the queue can retry it. */
export async function deliverEmail(msg: EmailMessage) {
  transport ??= defaultTransport();
  const { attachments, ...rest } = msg;
  await transport.sendMail({
    from: env.MAIL_FROM,
    ...rest,
    ...(attachments?.length ? { attachments: attachments.map((a) => ({ ...a, encoding: "base64" })) } : {}),
  });
  if (logToConsole) console.log(`[email] to=${msg.to} subject="${msg.subject}"\n        ${msg.text.split("\n")[0]}`);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain-text and HTML versions of a portal email. */
/** `url` null: no portal link (e.g. letters sent to a former employee's personal email). */
export function renderEmail(title: string, body: string, url: string | null) {
  const text = url ? `${body}\n\nOpen in the HR Portal: ${url}\n\n— EHB HR Portal (automated message)` : `${body}\n\n— EHB HR (automated message)`;
  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f6f9;font-family:Segoe UI,Arial,sans-serif;color:#1b2430">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
        <tr><td style="background:#1e3a5c;color:#ffffff;padding:16px 24px;font-size:12px;letter-spacing:.06em;text-transform:uppercase">EHB Technologies · HR Portal</td></tr>
        <tr><td style="padding:24px">
          <h1 style="margin:0 0 12px;font-size:18px">${escapeHtml(title)}</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.5">${escapeHtml(body)}</p>
          ${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;background:#1e3a5c;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">Open in the HR Portal</a>` : ""}
        </td></tr>
        <tr><td style="padding:12px 24px;color:#5b6573;font-size:12px;border-top:1px solid #eef2f6">Automated message from the EHB HR Portal.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { text, html };
}
