import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "./error.js";
import type { Role } from "../generated/prisma/client.js";

export type AuthUser = {
  id: number;
  code: string;
  email: string;
  fullName: string;
  roles: Role[];
  departmentId: number | null;
  managerId: number | null;
  mustChangePassword: boolean;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const signToken = (employeeId: number) =>
  jwt.sign({ sub: String(employeeId) }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });

/** Verifies the Bearer token and loads the current user fresh, so role changes apply immediately. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new HttpError(401, "Please log in");
  let employeeId: number;
  try {
    employeeId = Number((jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload).sub);
  } catch {
    throw new HttpError(401, "Your session has expired. Please log in again.");
  }
  const user = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true, code: true, email: true, fullName: true, roles: true,
      departmentId: true, managerId: true, mustChangePassword: true, status: true,
    },
  });
  if (!user || user.status !== "ACTIVE") throw new HttpError(401, "Account is not active");
  const { status: _status, ...rest } = user;
  req.user = rest;
  next();
};

export const hasRole = (user: AuthUser, ...roles: Role[]) => roles.some((r) => user.roles.includes(r));

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !hasRole(req.user, ...roles)) throw new HttpError(403, "You do not have access to this");
    next();
  };

/** The signed-in user; only call after requireAuth. */
export function currentUser(req: Express.Request): AuthUser {
  if (!req.user) throw new HttpError(401, "Please log in");
  return req.user;
}

/** Ids of the employees who report directly to this user. */
export async function teamIds(userId: number) {
  const rows = await prisma.employee.findMany({ where: { managerId: userId }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Can this user see work information (attendance, leave) for the given employee? */
export async function canSeeWorkInfo(user: AuthUser, employeeId: number) {
  if (user.id === employeeId) return true;
  if (hasRole(user, "HR", "MANAGEMENT")) return true;
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
  return emp?.managerId === user.id;
}
