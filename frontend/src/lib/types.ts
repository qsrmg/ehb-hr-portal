import type { Role } from "./auth";

export type ProbationStatus = "ON_PROBATION" | "DUE" | "CONFIRMED";
export type ProbationDecision = {
  id: number; kind: "CONFIRMED" | "EXTENDED"; previousProbationEndDate: string | null; newProbationEndDate: string | null;
  reason: string | null; decidedBy: string; at: string;
};
export type ProbationNote = { id: number; comment: string; author: string; at: string };
export type ProbationHistory = { decisions: ProbationDecision[]; notes: ProbationNote[] };

export type Profile = {
  id: number; code: string; email: string; fullName: string; designation: string | null; status: string; roles: Role[];
  department: { id: number; name: string } | null; manager: { id: number; fullName: string; code: string } | null; joiningDate: string; probationEndDate?: string | null; roleSince?: string | null; grade?: string | null;
  confirmedAt?: string | null; probationStatus?: ProbationStatus; probationHistory?: ProbationHistory;
  phone?: string | null; personalEmail?: string | null; address?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null;
  gender?: string | null; dateOfBirth?: string | null; machineId?: string | null;
  cnic?: string | null; fatherName?: string | null; maritalStatus?: string | null; familyDetails?: string | null;
  bankName?: string | null; bankAccount?: string | null; basicSalary?: number | null; grossSalary?: number | null;
};
