-- CreateEnum
CREATE TYPE "RequisitionReason" AS ENUM ('NEW', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'CONTRACT', 'INTERN');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'FILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PostingScope" AS ENUM ('INTERNAL', 'EXTERNAL', 'BOTH');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'NOT_SELECTED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'MANPOWER';

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "approvedHeadcount" INTEGER;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "grade" TEXT,
ADD COLUMN     "roleSince" DATE;

-- CreateTable
CREATE TABLE "Requisition" (
    "id" SERIAL NOT NULL,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" INTEGER NOT NULL,
    "requestId" INTEGER,
    "departmentId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "grade" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'PERMANENT',
    "reportsToId" INTEGER,
    "targetStartDate" DATE NOT NULL,
    "justification" TEXT NOT NULL,
    "skills" TEXT,
    "jdPath" TEXT,
    "jdName" TEXT,
    "reason" "RequisitionReason" NOT NULL,
    "exitCaseId" INTEGER,
    "replacesEmployeeId" INTEGER,
    "gradeChanged" BOOLEAN NOT NULL DEFAULT false,
    "overHeadcount" BOOLEAN NOT NULL DEFAULT false,
    "suggestedSalaryMin" DECIMAL(12,2),
    "suggestedSalaryMax" DECIMAL(12,2),
    "salaryMin" DECIMAL(12,2),
    "salaryMax" DECIMAL(12,2),
    "budgetNote" TEXT,
    "budgetConfirmedById" INTEGER,
    "budgetConfirmedAt" TIMESTAMP(3),
    "scope" "PostingScope",
    "description" TEXT,
    "requirements" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedById" INTEGER,
    "externalFrom" DATE,
    "closingDate" DATE,
    "closedAt" TIMESTAMP(3),
    "closedById" INTEGER,
    "closedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobApplication" (
    "id" SERIAL NOT NULL,
    "requisitionId" INTEGER NOT NULL,
    "employeeId" INTEGER,
    "candidateName" TEXT,
    "candidateEmail" TEXT,
    "candidatePhone" TEXT,
    "note" TEXT,
    "cvPath" TEXT,
    "cvName" TEXT,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "managerNotifiedAt" TIMESTAMP(3),
    "hiredEmployeeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "stage" "ApplicationStage" NOT NULL,
    "note" TEXT,
    "byId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewFeedback" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "recommendation" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Requisition_requestId_key" ON "Requisition"("requestId");

-- CreateIndex
CREATE INDEX "Requisition_status_idx" ON "Requisition"("status");

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_requisitionId_employeeId_key" ON "JobApplication"("requisitionId", "employeeId");

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_exitCaseId_fkey" FOREIGN KEY ("exitCaseId") REFERENCES "ExitCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_replacesEmployeeId_fkey" FOREIGN KEY ("replacesEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_budgetConfirmedById_fkey" FOREIGN KEY ("budgetConfirmedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_hiredEmployeeId_fkey" FOREIGN KEY ("hiredEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_byId_fkey" FOREIGN KEY ("byId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewFeedback" ADD CONSTRAINT "InterviewFeedback_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewFeedback" ADD CONSTRAINT "InterviewFeedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

