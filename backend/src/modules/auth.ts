import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, requireAuth, signToken } from "../middleware/auth.js";

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Enter your work email and password");
  const { email, password } = parsed.data;
  const employee = await prisma.employee.findUnique({ where: { email } });
  if (!employee || employee.status !== "ACTIVE" || !(await bcrypt.compare(password, employee.passwordHash))) {
    throw new HttpError(401, "Incorrect email or password");
  }
  await audit(employee.id, "LOGIN", "Employee", employee.id);
  res.json({ token: signToken(employee.id), mustChangePassword: employee.mustChangePassword });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = currentUser(req);
  const extra = await prisma.employee.findUniqueOrThrow({
    where: { id: user.id },
    select: { designation: true, department: { select: { name: true } }, manager: { select: { fullName: true } }, _count: { select: { reports: true } } },
  });
  res.json({
    ...user,
    designation: extra.designation,
    department: extra.department?.name ?? null,
    manager: extra.manager?.fullName ?? null,
    hasTeam: extra._count.reports > 0,
  });
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters")
    .regex(/[A-Za-z]/, "New password needs a letter")
    .regex(/\d/, "New password needs a number"),
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const user = currentUser(req);
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "));
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await bcrypt.compare(parsed.data.currentPassword, employee.passwordHash))) {
    throw new HttpError(400, "Current password is incorrect");
  }
  await prisma.employee.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 10), mustChangePassword: false },
  });
  await audit(user.id, "CHANGE_PASSWORD", "Employee", user.id);
  res.json({ ok: true });
});
