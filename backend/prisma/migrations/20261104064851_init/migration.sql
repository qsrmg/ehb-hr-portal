-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'LINE_MANAGER', 'HOD', 'HR', 'FINANCE', 'ADMIN', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('ON_TIME', 'LATE', 'HALF_DAY', 'ABSENT');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('LEAVE', 'ATTENDANCE_UPDATE', 'LETTER');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AttendanceUpdateKind" AS ENUM ('MISSED_PUNCH', 'FIELD_VISIT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('POLICY', 'HR_FORM');

-- CreateTable
CREATE TABLE "Department" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "hodId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "roles" "Role"[] DEFAULT ARRAY['EMPLOYEE']::"Role"[],
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "fullName" TEXT NOT NULL,
    "fatherName" TEXT,
    "gender" "Gender",
    "dateOfBirth" DATE,
    "designation" TEXT,
    "joiningDate" DATE NOT NULL,
    "departmentId" INTEGER,
    "managerId" INTEGER,
    "machineId" TEXT,
    "phone" TEXT,
    "personalEmail" TEXT,
    "address" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "cnic" TEXT,
    "maritalStatus" TEXT,
    "familyDetails" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "basicSalary" DECIMAL(12,2),
    "grossSalary" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceImport" (
    "id" SERIAL NOT NULL,
    "fileName" TEXT NOT NULL,
    "importedById" INTEGER NOT NULL,
    "rowsRead" INTEGER NOT NULL,
    "rowsImported" INTEGER NOT NULL,
    "unmatchedIds" TEXT[],
    "fromDate" DATE,
    "toDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "checkIn" INTEGER,
    "checkOut" INTEGER,
    "status" "AttendanceStatus" NOT NULL,
    "importId" INTEGER,
    "correctedCheckIn" INTEGER,
    "correctedCheckOut" INTEGER,
    "correctedStatus" "AttendanceStatus",
    "correctionRequestId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LateWarning" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "lateCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LateWarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "annualQuota" DECIMAL(5,1),
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "needsHrApproval" BOOLEAN NOT NULL DEFAULT false,
    "noticeDays" INTEGER NOT NULL DEFAULT 0,
    "documentAfterDays" INTEGER,
    "carryForwardMax" DECIMAL(5,1),
    "proRata" BOOLEAN NOT NULL DEFAULT true,
    "gender" "Gender",
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveBalance" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "leaveTypeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "entitled" DECIMAL(5,1) NOT NULL,
    "carriedForward" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "used" DECIMAL(5,1) NOT NULL DEFAULT 0,

    CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" SERIAL NOT NULL,
    "type" "RequestType" NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "outputPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestStep" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "approverId" INTEGER,
    "approverRole" "Role",
    "status" "StepStatus" NOT NULL DEFAULT 'WAITING',
    "actedById" INTEGER,
    "actedAt" TIMESTAMP(3),
    "comment" TEXT,
    "pendingSince" TIMESTAMP(3),
    "lastReminderAt" TIMESTAMP(3),

    CONSTRAINT "RequestStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestAction" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "stepOrder" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestAttachment" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "leaveTypeId" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceUpdateRequest" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "kind" "AttendanceUpdateKind" NOT NULL,
    "checkIn" INTEGER,
    "checkOut" INTEGER,
    "reason" TEXT NOT NULL,

    CONSTRAINT "AttendanceUpdateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollUpload" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedById" INTEGER NOT NULL,
    "rowsImported" INTEGER NOT NULL,
    "unmatched" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "uploadId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "basic" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "houseRent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "medical" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "conveyance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fuel" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "mobile" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "incomeTax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "eobi" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "providentFund" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "DocumentCategory" NOT NULL,
    "fileName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_code_key" ON "Employee"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_machineId_key" ON "Employee"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "AttendanceRecord_date_idx" ON "AttendanceRecord"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_employeeId_date_key" ON "AttendanceRecord"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LateWarning_employeeId_year_month_key" ON "LateWarning"("employeeId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_code_key" ON "LeaveType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalance_employeeId_leaveTypeId_year_key" ON "LeaveBalance"("employeeId", "leaveTypeId", "year");

-- CreateIndex
CREATE INDEX "Request_employeeId_status_idx" ON "Request"("employeeId", "status");

-- CreateIndex
CREATE INDEX "RequestStep_approverId_status_idx" ON "RequestStep"("approverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RequestStep_requestId_order_key" ON "RequestStep"("requestId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveRequest_requestId_key" ON "LeaveRequest"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceUpdateRequest_requestId_key" ON "AttendanceUpdateRequest"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_employeeId_year_month_key" ON "Payslip"("employeeId", "year", "month");

-- CreateIndex
CREATE INDEX "Notification_employeeId_read_idx" ON "Notification"("employeeId", "read");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_hodId_fkey" FOREIGN KEY ("hodId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_importId_fkey" FOREIGN KEY ("importId") REFERENCES "AttendanceImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateWarning" ADD CONSTRAINT "LateWarning_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestStep" ADD CONSTRAINT "RequestStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestStep" ADD CONSTRAINT "RequestStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestStep" ADD CONSTRAINT "RequestStep_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAction" ADD CONSTRAINT "RequestAction_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAction" ADD CONSTRAINT "RequestAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestAttachment" ADD CONSTRAINT "RequestAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceUpdateRequest" ADD CONSTRAINT "AttendanceUpdateRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "PayrollUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
