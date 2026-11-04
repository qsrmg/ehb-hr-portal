import { prisma } from "../lib/prisma.js";
import { employeeIdsWithRole, notify } from "../lib/notify.js";
import { HttpError } from "../middleware/error.js";
import { hasRole, type AuthUser } from "../middleware/auth.js";
import type { Prisma, RequestType, Role } from "../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;

/** One link in an approval chain: a specific person (line manager / HOD) or anyone holding a role. */
export type StepSpec = { label: string; approver: "LINE_MANAGER" | "HOD" | Role };

export const TYPE_LABELS: Record<RequestType, string> = {
  LEAVE: "Leave",
  ATTENDANCE_UPDATE: "Attendance Update",
  LETTER: "Letter Request",
};

type ResolvedStep = { order: number; label: string; approverId: number | null; approverRole: Role | null };

/** Turns a chain into concrete steps for this employee, skipping links that do not apply. */
export async function resolveSteps(db: Tx, employeeId: number, chain: StepSpec[]): Promise<ResolvedStep[]> {
  const emp = await db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { managerId: true, department: { select: { hodId: true } } },
  });
  const steps: Omit<ResolvedStep, "order">[] = [];
  for (const spec of chain) {
    if (spec.approver === "LINE_MANAGER" || spec.approver === "HOD") {
      const approverId = spec.approver === "LINE_MANAGER" ? emp.managerId : emp.department?.hodId ?? null;
      // No one to send it to, or the requester is their own approver: skip this link.
      if (!approverId || approverId === employeeId) continue;
      if (steps.some((s) => s.approverId === approverId)) continue;
      steps.push({ label: spec.label, approverId, approverRole: null });
    } else {
      steps.push({ label: spec.label, approverId: null, approverRole: spec.approver });
    }
  }
  // A request always has at least one approver; HR picks it up when nobody else applies.
  if (!steps.length) steps.push({ label: "HR", approverId: null, approverRole: "HR" });
  return steps.map((s, i) => ({ ...s, order: i }));
}

async function approversOf(step: { approverId: number | null; approverRole: Role | null }, requesterId: number) {
  if (step.approverId) return [step.approverId];
  if (step.approverRole) return (await employeeIdsWithRole(step.approverRole)).filter((id) => id !== requesterId);
  return [];
}

export async function createSteps(tx: Tx, requestId: number, steps: ResolvedStep[]) {
  const now = new Date();
  await tx.requestStep.createMany({
    data: steps.map((s) => ({
      requestId,
      order: s.order,
      label: s.label,
      approverId: s.approverId,
      approverRole: s.approverRole,
      status: s.order === 0 ? "PENDING" : "WAITING",
      pendingSince: s.order === 0 ? now : null,
    })),
  });
}

async function loadCurrentStep(requestId: number) {
  const request = await prisma.request.findUniqueOrThrow({
    where: { id: requestId },
    include: { steps: { include: { approver: { select: { fullName: true } } } }, employee: { select: { fullName: true } } },
  });
  const step = request.steps.find((s) => s.order === request.currentStep && s.status === "PENDING");
  return { request, step };
}

/** "Line Manager (Hamza Malik)" or "HR" for a role-pool step. */
const waitingFor = (step: { label: string; approver: { fullName: string } | null }) =>
  step.approver ? `${step.label} (${step.approver.fullName})` : step.label;

/** Submitted or resubmitted: confirmation to the employee, and the first approver is asked to act. */
export async function notifySubmitted(requestId: number, resubmitted = false) {
  const { request, step } = await loadCurrentStep(requestId);
  const verb = resubmitted ? "Resubmitted" : "Submitted";
  await notify(
    [request.employeeId],
    `${verb}: ${request.title}`,
    `Your request "${request.title}" has been ${verb.toLowerCase()} and is waiting for ${step ? waitingFor(step) : "approval"}.`,
    `/requests/${request.id}`,
  );
  await notifyCurrentApprovers(requestId);
}

/** Tell the approver(s) of the current step that something is waiting for them. */
export async function notifyCurrentApprovers(requestId: number) {
  const { request, step } = await loadCurrentStep(requestId);
  if (!step) return;
  await notify(
    await approversOf(step, request.employeeId),
    `Approval needed: ${request.title}`,
    `${request.employee.fullName} submitted "${request.title}". It is waiting for your approval (${step.label}).`,
    `/requests/${request.id}`,
  );
}

export function canActOnStep(user: AuthUser, requesterId: number, step: { status: string; approverId: number | null; approverRole: Role | null }) {
  if (step.status !== "PENDING" || user.id === requesterId) return false;
  if (step.approverId) return step.approverId === user.id;
  return step.approverRole ? hasRole(user, step.approverRole) : false;
}

export type OnApproved = (tx: Tx, requestId: number, finalApproverId: number) => Promise<void>;

/** Approve, reject or return the current step. Every action is recorded with who, when and the comment. */
export async function actOnRequest(
  requestId: number,
  user: AuthUser,
  action: "APPROVE" | "REJECT" | "RETURN",
  comment: string | undefined,
  onApproved: OnApproved,
) {
  if ((action === "REJECT" || action === "RETURN") && !comment?.trim()) {
    throw new HttpError(400, action === "REJECT" ? "Give a reason for rejecting" : "Say what needs to be changed");
  }
  const outcome = await prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({ where: { id: requestId }, include: { steps: { orderBy: { order: "asc" } } } });
    if (!request) throw new HttpError(404, "Request not found");
    if (request.status !== "PENDING") throw new HttpError(400, `This request is already ${request.status.toLowerCase()}`);
    const step = request.steps.find((s) => s.order === request.currentStep);
    if (!step || !canActOnStep(user, request.employeeId, step)) throw new HttpError(403, "This request is not waiting for your approval");

    const now = new Date();
    const stepStatus = action === "APPROVE" ? "APPROVED" : action === "REJECT" ? "REJECTED" : "RETURNED";
    await tx.requestStep.update({
      where: { id: step.id },
      data: { status: stepStatus, actedById: user.id, actedAt: now, comment: comment?.trim() || null },
    });
    await tx.requestAction.create({
      data: { requestId, actorId: user.id, action: stepStatus, stepOrder: step.order, comment: comment?.trim() || null },
    });

    if (action !== "APPROVE") {
      await tx.request.update({ where: { id: requestId }, data: { status: stepStatus } });
      return { request, final: stepStatus, step };
    }
    const next = request.steps.find((s) => s.order === step.order + 1);
    if (next) {
      await tx.requestStep.update({ where: { id: next.id }, data: { status: "PENDING", pendingSince: now } });
      await tx.request.update({ where: { id: requestId }, data: { currentStep: next.order } });
      return { request, final: null, step };
    }
    await tx.request.update({ where: { id: requestId }, data: { status: "APPROVED" } });
    await onApproved(tx, requestId, user.id);
    return { request, final: "APPROVED" as const, step };
  });

  const { request, final, step } = outcome;
  const link = `/requests/${request.id}`;
  if (final === null) {
    const { step: next } = await loadCurrentStep(request.id);
    await notify(
      [request.employeeId],
      `Approved by ${step.label}: ${request.title}`,
      `${step.label} approved your request. It is now waiting for ${next ? waitingFor(next) : "the next approver"}.`,
      link,
    );
    await notifyCurrentApprovers(request.id);
  } else if (final === "APPROVED") {
    await notify([request.employeeId], `Approved: ${request.title}`, `Your request "${request.title}" has been approved.`, link);
  } else if (final === "REJECTED") {
    await notify([request.employeeId], `Rejected: ${request.title}`, `Your request was rejected by ${step.label}. Reason: ${comment}`, link);
  } else {
    await notify([request.employeeId], `Returned for changes: ${request.title}`, `${step.label} returned your request: ${comment}. Edit and resubmit it.`, link);
  }
}

/** Employee resubmits a returned request: approvers are resolved again and the chain restarts. */
export async function restartChain(tx: Tx, requestId: number, employeeId: number, chain: StepSpec[], actorId: number) {
  await tx.requestStep.deleteMany({ where: { requestId } });
  await createSteps(tx, requestId, await resolveSteps(tx, employeeId, chain));
  await tx.request.update({ where: { id: requestId }, data: { status: "PENDING", currentStep: 0 } });
  await tx.requestAction.create({ data: { requestId, actorId, action: "RESUBMITTED" } });
}

export async function cancelRequest(requestId: number, user: AuthUser) {
  const request = await prisma.request.findUnique({ where: { id: requestId } });
  if (!request) throw new HttpError(404, "Request not found");
  if (request.employeeId !== user.id) throw new HttpError(403, "Only the person who submitted it can cancel this request");
  if (!["PENDING", "RETURNED"].includes(request.status)) throw new HttpError(400, "Only pending or returned requests can be cancelled");
  const { step } = await loadCurrentStep(requestId);
  const approvers = step ? await approversOf(step, request.employeeId) : [];
  await prisma.$transaction([
    prisma.request.update({ where: { id: requestId }, data: { status: "CANCELLED" } }),
    prisma.requestStep.updateMany({ where: { requestId, status: { in: ["PENDING", "WAITING"] } }, data: { status: "SKIPPED" } }),
    prisma.requestAction.create({ data: { requestId, actorId: user.id, action: "CANCELLED" } }),
  ]);
  await notify(approvers, `Cancelled: ${request.title}`, `${user.fullName} cancelled "${request.title}". No action is needed.`, `/requests/${requestId}`);
}

/** Pending steps this user can act on right now (personal and role-pool steps). */
export function pendingForUserWhere(user: AuthUser): Prisma.RequestStepWhereInput {
  return {
    status: "PENDING",
    request: { status: "PENDING", employeeId: { not: user.id } },
    OR: [{ approverId: user.id }, ...(user.roles.length ? [{ approverId: null, approverRole: { in: user.roles } }] : [])],
  };
}
