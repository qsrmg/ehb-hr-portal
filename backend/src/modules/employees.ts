import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { audit, diff } from "../lib/audit.js";
import { sheetUpload } from "../lib/upload.js";
import { readSheet, pickString, parseSheetDate, parseSheetNumber } from "../lib/sheet.js";
import { toDate, todayYmd, ymd } from "../lib/dates.js";
import { HttpError } from "../middleware/error.js";
import { currentUser, hasRole, requireAuth, requireRole, type AuthUser } from "../middleware/auth.js";
import { recalculateEntitlements } from "../services/leave.js";
import { employeeDeactivated } from "./assets.js";
import { addJoinerToOpenCycles } from "../services/performance.js";
import type { Employee, Prisma } from "../generated/prisma/client.js";

export const employeesRouter = Router();
employeesRouter.use(requireAuth);

const ROLES = ["EMPLOYEE", "LINE_MANAGER", "HOD", "HR", "FINANCE", "ADMIN", "MANAGEMENT"] as const;

type EmployeeWithRelations = Employee & {
  department: { id: number; name: string } | null;
  manager: { id: number; fullName: string; code: string } | null;
};

const withRelations = {
  department: { select: { id: true, name: true } },
  manager: { select: { id: true, fullName: true, code: true } },
} satisfies Prisma.EmployeeInclude;

/**
 * Field-level visibility from the privacy rules:
 * work info for the person, their line manager and HR/Management; contact details for the person and HR;
 * CNIC and family details for HR only; bank details for HR and Finance (payroll);
 * salary for the person, HR, Finance and Management.
 */
function present(e: EmployeeWithRelations, viewer: AuthUser) {
  const self = viewer.id === e.id;
  const hr = hasRole(viewer, "HR");
  const finance = hasRole(viewer, "FINANCE");
  const management = hasRole(viewer, "MANAGEMENT");
  const out: Record<string, unknown> = {
    id: e.id,
    code: e.code,
    email: e.email,
    fullName: e.fullName,
    designation: e.designation,
    department: e.department,
    manager: e.manager,
    joiningDate: ymd(e.joiningDate),
    probationEndDate: e.probationEndDate ? ymd(e.probationEndDate) : null,
    status: e.status,
    roles: e.roles,
  };
  if (self || hr) {
    Object.assign(out, {
      phone: e.phone, personalEmail: e.personalEmail, address: e.address,
      emergencyContactName: e.emergencyContactName, emergencyContactPhone: e.emergencyContactPhone,
      gender: e.gender, dateOfBirth: e.dateOfBirth ? ymd(e.dateOfBirth) : null, machineId: e.machineId,
    });
  }
  if (self || hr) Object.assign(out, { cnic: e.cnic, fatherName: e.fatherName, maritalStatus: e.maritalStatus, familyDetails: e.familyDetails });
  if (self || hr || finance) Object.assign(out, { bankName: e.bankName, bankAccount: e.bankAccount });
  if (self || hr || finance || management) {
    Object.assign(out, {
      basicSalary: e.basicSalary == null ? null : Number(e.basicSalary),
      grossSalary: e.grossSalary == null ? null : Number(e.grossSalary),
    });
  }
  return out;
}

const sensitiveFieldsShown = (viewer: AuthUser, employeeId: number) =>
  viewer.id !== employeeId && hasRole(viewer, "HR", "FINANCE", "MANAGEMENT");

/** Next code in the series for the joining year, e.g. EHB-2026-007. */
async function nextEmployeeCode(year: number, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const prefix = `EHB-${year}-`;
  const last = await db.employee.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: "desc" }, select: { code: true } });
  const n = last ? Number(last.code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(3, "0")}`;
}

employeesRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
  const status = req.query.status === "INACTIVE" ? "INACTIVE" : req.query.status === "ALL" ? undefined : "ACTIVE";
  const fullAccess = hasRole(user, "HR", "MANAGEMENT", "FINANCE", "ADMIN");
  const where: Prisma.EmployeeWhereInput = {
    ...(fullAccess ? {} : { managerId: user.id }),
    ...(status ? { status } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(q
      ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
      : {}),
  };
  const rows = await prisma.employee.findMany({ where, include: withRelations, orderBy: { code: "asc" } });
  // Lists show work information only; open a profile for more.
  res.json(
    rows.map((e) => ({
      id: e.id, code: e.code, fullName: e.fullName, email: e.email, designation: e.designation,
      department: e.department?.name ?? null, manager: e.manager?.fullName ?? null, roles: e.roles,
      status: e.status, joiningDate: ymd(e.joiningDate),
    })),
  );
});

employeesRouter.get("/me", async (req, res) => {
  const user = currentUser(req);
  const e = await prisma.employee.findUniqueOrThrow({ where: { id: user.id }, include: withRelations });
  res.json(present(e, user));
});

const contactSchema = z.object({
  phone: z.string().trim().max(30).nullable().optional(),
  personalEmail: z.string().trim().email().or(z.literal("")).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  emergencyContactName: z.string().trim().max(100).nullable().optional(),
  emergencyContactPhone: z.string().trim().max(30).nullable().optional(),
});

// Employees update their own contact details
employeesRouter.patch("/me/contact", async (req, res) => {
  const user = currentUser(req);
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const data = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v === "" ? null : v]));
  const before = await prisma.employee.findUniqueOrThrow({ where: { id: user.id } });
  const updated = await prisma.employee.update({ where: { id: user.id }, data, include: withRelations });
  await audit(user.id, "UPDATE", "Employee", user.id, { changes: diff(before, data) } as Prisma.InputJsonValue);
  res.json(present(updated, user));
});

employeesRouter.get("/:id", async (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  const e = await prisma.employee.findUnique({ where: { id }, include: withRelations });
  if (!e) throw new HttpError(404, "Employee not found");
  const allowed = e.id === user.id || e.managerId === user.id || hasRole(user, "HR", "MANAGEMENT", "FINANCE", "ADMIN");
  if (!allowed) throw new HttpError(403, "You can only view your own team");
  if (sensitiveFieldsShown(user, id)) await audit(user.id, "VIEW_SENSITIVE", "Employee", id);
  res.json(present(e, user));
});

const optionalText = z.string().trim().nullable().optional().transform((v) => (v === "" ? null : v));
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("").transform(() => null));
const optionalMoney = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : Number(v)));

const hrEmployeeSchema = z.object({
  email: z.string().trim().toLowerCase().email().optional(),
  fullName: z.string().trim().min(2).optional(),
  fatherName: optionalText,
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).nullable().optional(),
  dateOfBirth: optionalDate,
  designation: optionalText,
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  probationEndDate: optionalDate,
  departmentId: z.number().int().nullable().optional(),
  managerId: z.number().int().nullable().optional(),
  machineId: optionalText,
  roles: z.array(z.enum(ROLES)).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  phone: optionalText,
  personalEmail: optionalText,
  address: optionalText,
  emergencyContactName: optionalText,
  emergencyContactPhone: optionalText,
  cnic: optionalText,
  maritalStatus: optionalText,
  familyDetails: optionalText,
  bankName: optionalText,
  bankAccount: optionalText,
  basicSalary: optionalMoney,
  grossSalary: optionalMoney,
});

function toDbFields(input: z.infer<typeof hrEmployeeSchema>) {
  const { dateOfBirth, joiningDate, probationEndDate, roles, ...rest } = input;
  const data: Record<string, unknown> = { ...rest };
  if (dateOfBirth !== undefined) data.dateOfBirth = dateOfBirth ? toDate(dateOfBirth) : null;
  if (joiningDate !== undefined) data.joiningDate = toDate(joiningDate);
  if (probationEndDate !== undefined) data.probationEndDate = probationEndDate ? toDate(probationEndDate) : null;
  if (roles !== undefined) data.roles = [...new Set<string>(["EMPLOYEE", ...roles])];
  return data;
}

function parseHrBody(body: unknown) {
  const parsed = hrEmployeeSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

function uniqueError(err: unknown): never {
  if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
    throw new HttpError(409, "Another employee already uses this email or machine ID");
  }
  throw err;
}

employeesRouter.post("/", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const input = parseHrBody(req.body);
  if (!input.email || !input.fullName || !input.joiningDate) throw new HttpError(400, "Email, full name and joining date are required");
  if (input.managerId) await assertEmployee(input.managerId);
  const code = await nextEmployeeCode(Number(input.joiningDate.slice(0, 4)));
  const created = await prisma.employee
    .create({
      data: {
        ...(toDbFields(input) as Prisma.EmployeeUncheckedCreateInput),
        code,
        passwordHash: await bcrypt.hash(env.DEFAULT_PASSWORD, 10),
        mustChangePassword: true,
      },
      include: withRelations,
    })
    .catch(uniqueError);
  await audit(user.id, "CREATE", "Employee", created.id, { code });
  // Joiners in the first months of an open performance cycle are included in it.
  await addJoinerToOpenCycles(created.id);
  res.status(201).json({ ...present(created, user), initialPassword: env.DEFAULT_PASSWORD });
});

async function assertEmployee(id: number) {
  if (!(await prisma.employee.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(400, "Selected manager does not exist");
}

// HR changes job, department, manager, salary and other fields
employeesRouter.patch("/:id", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  const input = parseHrBody(req.body);
  if (input.managerId === id) throw new HttpError(400, "An employee cannot be their own manager");
  if (input.managerId) await assertEmployee(input.managerId);
  const before = await prisma.employee.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Employee not found");
  const data = toDbFields(input);
  const updated = await prisma.employee.update({ where: { id }, data, include: withRelations }).catch(uniqueError);
  // A new joining date changes the pro-rated leave entitlement.
  const joiningChanged = input.joiningDate !== undefined && input.joiningDate !== ymd(before.joiningDate);
  const leaveRecalculated = joiningChanged ? await recalculateEntitlements({ employeeId: id }) : null;
  await audit(user.id, "UPDATE", "Employee", id, { changes: diff(before, data), leaveRecalculated } as Prisma.InputJsonValue);
  // Leaving while still holding company items: Admin is asked to collect them.
  if (before.status === "ACTIVE" && input.status === "INACTIVE") await employeeDeactivated(id);
  res.json({ ...present(updated, user), leaveRecalculated });
});

employeesRouter.post("/:id/reset-password", requireRole("HR"), async (req, res) => {
  const user = currentUser(req);
  const id = Number(req.params.id);
  await prisma.employee.update({
    where: { id },
    data: { passwordHash: await bcrypt.hash(env.DEFAULT_PASSWORD, 10), mustChangePassword: true },
  });
  await audit(user.id, "RESET_PASSWORD", "Employee", id);
  res.json({ ok: true, initialPassword: env.DEFAULT_PASSWORD });
});

const GENDERS: Record<string, "MALE" | "FEMALE" | "OTHER"> = { male: "MALE", m: "MALE", female: "FEMALE", f: "FEMALE", other: "OTHER" };

/**
 * Starting records from the "Employee Personal Information" Google Form export (CSV or Excel).
 * Headers are matched loosely; existing emails are skipped. Each new employee gets a code like EHB-2026-001.
 */
employeesRouter.post("/import", requireRole("HR"), sheetUpload.single("file"), async (req, res) => {
  const user = currentUser(req);
  if (!req.file) throw new HttpError(400, "Choose a file to import");
  const rows = await readSheet(req.file.buffer, req.file.originalname);
  const passwordHash = await bcrypt.hash(env.DEFAULT_PASSWORD, 10);
  const created: { code: string; fullName: string; email: string }[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const managerLinks: { employeeId: number; manager: string }[] = [];

  for (const [i, row] of rows.entries()) {
    const rowNo = i + 2;
    const email = pickString(row, ["workemail", "officialemail", "companyemail", "email", "emailaddress"])?.toLowerCase();
    const fullName = pickString(row, ["fullname", "name", "employeename"]);
    if (!email || !fullName) { skipped.push({ row: rowNo, reason: "Missing name or email" }); continue; }
    if (await prisma.employee.findUnique({ where: { email }, select: { id: true } })) {
      skipped.push({ row: rowNo, reason: `${email} already exists` }); continue;
    }
    const joining = parseSheetDate(pickString(row, ["joiningdate", "dateofjoining", "doj", "joindate"]) ?? null) ?? todayYmd();
    const deptName = pickString(row, ["department", "dept"]);
    const department = deptName
      ? await prisma.department.upsert({ where: { name: deptName }, create: { name: deptName }, update: {} })
      : null;
    const machineId = pickString(row, ["machineid", "biometricid", "attendanceid"]);
    if (machineId && (await prisma.employee.findUnique({ where: { machineId }, select: { id: true } }))) {
      skipped.push({ row: rowNo, reason: `Machine ID ${machineId} is already assigned` }); continue;
    }
    const dob = parseSheetDate(pickString(row, ["dateofbirth", "dob", "birthdate"]) ?? null);
    const gender = GENDERS[(pickString(row, ["gender", "sex"]) ?? "").toLowerCase()] ?? null;
    const salary = parseSheetNumber(pickString(row, ["grosssalary", "salary"]));
    const code = await nextEmployeeCode(Number(joining.slice(0, 4)));
    const emp = await prisma.employee.create({
      data: {
        code, email, fullName, passwordHash, gender, machineId,
        joiningDate: toDate(joining),
        dateOfBirth: dob ? toDate(dob) : null,
        departmentId: department?.id ?? null,
        designation: pickString(row, ["designation", "jobtitle", "position"]),
        fatherName: pickString(row, ["fathername", "fathersname", "fatherhusbandname"]),
        phone: pickString(row, ["phone", "mobile", "mobilenumber", "phonenumber", "contactnumber", "contactno"]),
        personalEmail: pickString(row, ["personalemail"]),
        address: pickString(row, ["address", "currentaddress", "residentialaddress"]),
        cnic: pickString(row, ["cnic", "cnicnumber", "cnicno", "nationalid"]),
        maritalStatus: pickString(row, ["maritalstatus"]),
        familyDetails: pickString(row, ["familydetails", "dependents"]),
        emergencyContactName: pickString(row, ["emergencycontactname", "emergencycontact"]),
        emergencyContactPhone: pickString(row, ["emergencycontactnumber", "emergencycontactphone", "emergencyphone"]),
        bankName: pickString(row, ["bankname", "bank"]),
        bankAccount: pickString(row, ["bankaccount", "accountnumber", "iban", "accountno"]),
        grossSalary: salary,
      },
    });
    created.push({ code, fullName, email });
    const manager = pickString(row, ["manageremail", "linemanageremail", "linemanager", "manager", "reportingto"]);
    if (manager) managerLinks.push({ employeeId: emp.id, manager: manager.toLowerCase() });
  }

  // Link managers after everyone exists (manager column may hold an email or an employee code).
  let managersLinked = 0;
  for (const link of managerLinks) {
    const mgr = await prisma.employee.findFirst({
      where: { OR: [{ email: link.manager }, { code: { equals: link.manager, mode: "insensitive" } }] },
      select: { id: true, roles: true },
    });
    if (!mgr || mgr.id === link.employeeId) continue;
    await prisma.employee.update({ where: { id: link.employeeId }, data: { managerId: mgr.id } });
    if (!mgr.roles.includes("LINE_MANAGER")) {
      await prisma.employee.update({ where: { id: mgr.id }, data: { roles: { push: "LINE_MANAGER" } } });
      mgr.roles.push("LINE_MANAGER");
    }
    managersLinked++;
  }

  await audit(user.id, "IMPORT", "Employee", null, { fileName: req.file.originalname, created: created.length, skipped: skipped.length });
  res.json({ rowsRead: rows.length, created, skipped, managersLinked, initialPassword: env.DEFAULT_PASSWORD });
});
