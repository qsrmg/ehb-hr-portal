import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { FINANCE_SETTING_PREFIXES, getSettings, isBooleanSetting, isOptionalSetting, isTextSetting, SETTING_DEFAULTS, type SettingKey } from "../lib/settings.js";
import { toDate, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";

// Holidays, settings, notifications and the audit log
export const adminRouter = Router();
adminRouter.use(requireAuth);

adminRouter.get("/holidays", async (req, res) => {
  const year = typeof req.query.year === "string" && /^\d{4}$/.test(req.query.year) ? Number(req.query.year) : new Date().getUTCFullYear();
  const rows = await prisma.holiday.findMany({ where: { date: { gte: toDate(`${year}-01-01`), lte: toDate(`${year}-12-31`) } }, orderBy: { date: "asc" } });
  res.json(rows.map((h) => ({ id: h.id, date: ymd(h.date), name: h.name })));
});

const holidaySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(2) });

adminRouter.post("/holidays", requireRole("HR"), async (req, res) => {
  const parsed = holidaySchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Enter a date and holiday name");
  const h = await prisma.holiday.create({ data: { date: toDate(parsed.data.date), name: parsed.data.name } }).catch(() => {
    throw new HttpError(409, "There is already a holiday on that date");
  });
  await audit(currentUser(req).id, "CREATE", "Holiday", h.id, parsed.data);
  res.status(201).json({ id: h.id, date: ymd(h.date), name: h.name });
});

adminRouter.delete("/holidays/:id", requireRole("HR"), async (req, res) => {
  const h = await prisma.holiday.delete({ where: { id: Number(req.params.id) } });
  await audit(currentUser(req).id, "DELETE", "Holiday", h.id, { date: ymd(h.date), name: h.name });
  res.json({ ok: true });
});

/** HR edits every setting; Finance edits the expense settings only. */
const editableBy = (user: AuthUser, key: string) =>
  hasRole(user, "HR") || (hasRole(user, "FINANCE") && FINANCE_SETTING_PREFIXES.some((p) => key.startsWith(p)));

adminRouter.get("/settings", requireRole("HR", "FINANCE"), async (req, res) => {
  const user = currentUser(req);
  const values = await getSettings();
  res.json(
    Object.entries(SETTING_DEFAULTS)
      .filter(([key]) => editableBy(user, key))
      .map(([key, def]) => ({ key, label: def.label, value: values[key as SettingKey], default: def.value, optional: isOptionalSetting(key as SettingKey), boolean: isBooleanSetting(key as SettingKey) })),
  );
});

adminRouter.put("/settings", requireRole("HR", "FINANCE"), async (req, res) => {
  const user = currentUser(req);
  const body = z.record(z.string(), z.string()).safeParse(req.body);
  if (!body.success) throw new HttpError(400, "Invalid settings");
  const before = await getSettings();
  const changes: Record<string, { from: string; to: string }> = {};
  // Performance bands must run downwards between 1 and 5 (rating 5 from the highest score).
  const merged = { ...before, ...body.data } as Record<string, string>;
  const bands = [5, 4, 3, 2].map((n) => Number(merged[`performance.band${n}From`]));
  if (bands.some((b) => !(b > 1 && b <= 5)) || bands.some((b, i) => i > 0 && b >= bands[i - 1]!)) {
    throw new HttpError(400, "Performance bands: each score must be between 1 and 5 and lower than the band above it");
  }
  for (const [key, raw] of Object.entries(body.data)) {
    if (!(key in SETTING_DEFAULTS)) throw new HttpError(400, `Unknown setting ${key}`);
    if (!editableBy(user, key)) throw new HttpError(403, `You cannot change ${SETTING_DEFAULTS[key as SettingKey].label}`);
    const value = raw.trim();
    const isTime = SETTING_DEFAULTS[key as SettingKey].value.includes(":");
    const emptyAllowed = value === "" && isOptionalSetting(key as SettingKey);
    if (isTextSetting(key as SettingKey)) {
      if (value.length < 2 || value.length > 40) throw new HttpError(400, `${SETTING_DEFAULTS[key as SettingKey].label}: enter a name of 2 to 40 characters`);
    } else if (isBooleanSetting(key as SettingKey)) {
      if (value !== "0" && value !== "1") throw new HttpError(400, `${SETTING_DEFAULTS[key as SettingKey].label}: on or off`);
    } else if (!emptyAllowed && (isTime ? !/^\d{2}:\d{2}$/.test(value) : !/^\d+(\.\d+)?$/.test(value))) {
      throw new HttpError(400, `${SETTING_DEFAULTS[key as SettingKey].label}: enter ${isTime ? "a time as HH:MM" : "a number"}`);
    }
    if (before[key as SettingKey] !== value) changes[key] = { from: before[key as SettingKey], to: value };
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  await audit(currentUser(req).id, "UPDATE", "Setting", null, changes);
  res.json({ ok: true });
});

adminRouter.get("/notifications", async (req, res) => {
  const user = currentUser(req);
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where: { employeeId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { employeeId: user.id, read: false } }),
  ]);
  res.json({ unread, items: rows });
});

adminRouter.post("/notifications/read-all", async (req, res) => {
  await prisma.notification.updateMany({ where: { employeeId: currentUser(req).id, read: false }, data: { read: true } });
  res.json({ ok: true });
});

adminRouter.post("/notifications/:id/read", async (req, res) => {
  await prisma.notification.updateMany({ where: { id: Number(req.params.id), employeeId: currentUser(req).id }, data: { read: true } });
  res.json({ ok: true });
});

adminRouter.get("/audit", requireRole("HR", "MANAGEMENT"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const entity = typeof req.query.entity === "string" && req.query.entity ? req.query.entity : undefined;
  const action = typeof req.query.action === "string" && req.query.action ? req.query.action : undefined;
  const where = { ...(entity ? { entity } : {}), ...(action ? { action } : {}) };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50,
      include: { actor: { select: { fullName: true, code: true } } },
    }),
  ]);
  res.json({ total, page, pageSize: 50, items: rows });
});
