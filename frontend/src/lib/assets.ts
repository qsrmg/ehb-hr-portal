export type AssetCategory = {
  id: number; name: string; kind: "PHYSICAL" | "ACCESS"; mustReturnOnExit: boolean; active: boolean; sortOrder: number;
  dataBearing: boolean; transferAuthorisingRole: string | null;
};

export const CONDITIONS: Record<string, string> = { NEW: "New", GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" };
export const INCIDENT_TYPES: Record<string, string> = { NOT_WORKING: "Not working", DAMAGED: "Damaged", LOST: "Lost" };
export const RECOVERY_FINDINGS: Record<string, string> = {
  NEGLIGENCE: "Negligence", MISUSE: "Misuse", UNAUTHORISED_USE: "Unauthorised use", PROCEDURE_VIOLATION: "Procedure violation", WEAR_AND_TEAR: "Wear and tear (no recovery)",
};
export const DISPOSAL_REASONS: Record<string, string> = { DISPOSED: "Disposed", SOLD: "Sold", REPLACED: "Replaced", WRITTEN_OFF: "Written off" };

export type Accessory = { id: number; name: string; quantity: number; returned: boolean };

export type Incident = {
  id: number; type: string; status: string; description: string; createdAt: string;
  employee?: { fullName: string; code: string } | null; reportedBy?: string; recordedBy?: string | null; adminNote?: string | null;
  finding?: string | null;
  recoveryAmount: number | null; recoverySetBy?: string | null; recoveryNote: string | null;
  recoveryApprovedBy?: string | null; recoveryApprovedAt?: string | null;
  writtenOffBy?: string | null; writeOffNote: string | null;
  hasAttachment?: boolean; policeReportSuggested?: boolean;
};

export type Assignment = {
  id: number; assigneeType: "EMPLOYEE" | "DEPARTMENT" | "LOCATION"; assignee: string;
  employee: { id: number; fullName: string; code: string } | null; department: { id: number; name: string } | null; location: string | null;
  issuedAt: string; issuedBy: string; conditionOut: string; issueNote: string | null; authorisationNote?: string | null; confirmedAt: string | null;
  returnedAt: string | null; receivedBy: string | null; conditionIn: string | null; returnNote: string | null; requestId: number | null;
  accessories: Accessory[];
};

export type AssetDetail = {
  id: number; tag: string; name: string;
  category: { id: number; name: string; kind: "PHYSICAL" | "ACCESS"; mustReturnOnExit: boolean; dataBearing: boolean };
  serialNumber: string | null; purchaseDate: string | null; cost?: number | null; warrantyUntil: string | null;
  condition: string; status: string; storageLocation: string | null; notes: string | null;
  disposalReason?: string | null; disposalDate?: string | null;
  current: Assignment | null; assignments: Assignment[];
  repairs: { id: number; vendor: string; sentOn: string; returnedOn: string | null; cost?: number | null; note: string | null; createdBy: string }[];
  incidents: Incident[];
};

export type Clearance = {
  employeeId: number; cleared: boolean;
  outstanding: { assignmentId: number; assetId: number; tag: string; name: string; category: string; kind: string; issuedAt: string; action: string }[];
  recoveries?: { incidentId: number; tag: string; name: string; type: string; amount: number; note: string | null }[];
  recoveryTotal?: number;
  pendingDecisions: { incidentId: number; tag: string; name: string; type: string; status: string }[];
  retained: { assignmentId: number; tag: string; name: string; category: string; retainedBy: string; retainedAt: string; note: string | null }[];
  stillHeldNotRequired: { tag: string; name: string; category: string }[];
};
