export type AssetCategory = { id: number; name: string; kind: "PHYSICAL" | "ACCESS"; mustReturnOnExit: boolean; active: boolean; sortOrder: number };

export const CONDITIONS: Record<string, string> = { NEW: "New", GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged" };
export const INCIDENT_TYPES: Record<string, string> = { NOT_WORKING: "Not working", DAMAGED: "Damaged", LOST: "Lost" };

export type Incident = {
  id: number; type: string; status: string; description: string; createdAt: string;
  employee?: { fullName: string; code: string } | null; reportedBy?: string; recordedBy?: string | null; adminNote?: string | null;
  recoveryAmount: number | null; recoverySetBy?: string | null; recoveryNote: string | null;
  writtenOffBy?: string | null; writeOffNote: string | null;
};

export type Assignment = {
  id: number; assigneeType: "EMPLOYEE" | "DEPARTMENT" | "LOCATION"; assignee: string;
  employee: { id: number; fullName: string; code: string } | null; department: { id: number; name: string } | null; location: string | null;
  issuedAt: string; issuedBy: string; conditionOut: string; issueNote: string | null; confirmedAt: string | null;
  returnedAt: string | null; receivedBy: string | null; conditionIn: string | null; returnNote: string | null; requestId: number | null;
};

export type AssetDetail = {
  id: number; tag: string; name: string;
  category: { id: number; name: string; kind: "PHYSICAL" | "ACCESS"; mustReturnOnExit: boolean };
  serialNumber: string | null; purchaseDate: string | null; cost?: number | null; warrantyUntil: string | null;
  condition: string; status: string; storageLocation: string | null; notes: string | null;
  current: Assignment | null; assignments: Assignment[];
  repairs: { id: number; vendor: string; sentOn: string; returnedOn: string | null; cost?: number | null; note: string | null; createdBy: string }[];
  incidents: Incident[];
};

export type Clearance = {
  employeeId: number; cleared: boolean;
  outstanding: { assignmentId: number; assetId: number; tag: string; name: string; category: string; kind: string; issuedAt: string; action: string }[];
  recoveries: { incidentId: number; tag: string; name: string; type: string; amount: number; note: string | null }[];
  recoveryTotal: number;
  pendingDecisions: { incidentId: number; tag: string; name: string; type: string; status: string }[];
  stillHeldNotRequired: { tag: string; name: string; category: string }[];
};
