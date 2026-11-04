import type { Role } from "./auth";

export type Profile = {
  id: number; code: string; email: string; fullName: string; designation: string | null; status: string; roles: Role[];
  department: { id: number; name: string } | null; manager: { id: number; fullName: string; code: string } | null; joiningDate: string;
  phone?: string | null; personalEmail?: string | null; address?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null;
  gender?: string | null; dateOfBirth?: string | null; machineId?: string | null;
  cnic?: string | null; fatherName?: string | null; maritalStatus?: string | null; familyDetails?: string | null;
  bankName?: string | null; bankAccount?: string | null; basicSalary?: number | null; grossSalary?: number | null;
};
