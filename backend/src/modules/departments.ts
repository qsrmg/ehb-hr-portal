import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, requireAuth, requireRole } from "../middleware/auth.js";

export const departmentsRouter = Router();
departmentsRouter.use(requireAuth);

departmentsRouter.get("/", async (_req, res) => {
  const rows = await prisma.department.findMany({
    orderBy: { name: "asc" },
    include: { hod: { select: { id: true, fullName: true } }, _count: { select: { employees: { where: { status: "ACTIVE" } } } } },
  });
  res.json(rows.map((d) => ({ id: d.id, name: d.name, hod: d.hod, employeeCount: d._count.employees })));
});

const schema = z.object({ name: z.string().trim().min(2), hodId: z.number().int().nullable().optional() });

/** Setting a HOD also gives that person the HOD role. */
async function grantHod(hodId: number | null | undefined) {
  if (!hodId) return;
  const emp = await prisma.employee.findUnique({ where: { id: hodId }, select: { roles: true } });
  if (!emp) throw new HttpError(400, "Selected HOD does not exist");
  if (!emp.roles.includes("HOD")) await prisma.employee.update({ where: { id: hodId }, data: { roles: { push: "HOD" } } });
}

departmentsRouter.post("/", requireRole("HR"), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Department name is required");
  await grantHod(parsed.data.hodId);
  const dept = await prisma.department.create({ data: parsed.data }).catch(() => {
    throw new HttpError(409, "A department with this name already exists");
  });
  await audit(currentUser(req).id, "CREATE", "Department", dept.id, parsed.data);
  res.status(201).json(dept);
});

departmentsRouter.patch("/:id", requireRole("HR"), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Invalid department");
  await grantHod(parsed.data.hodId);
  const dept = await prisma.department.update({ where: { id: Number(req.params.id) }, data: parsed.data });
  await audit(currentUser(req).id, "UPDATE", "Department", dept.id, parsed.data);
  res.json(dept);
});
