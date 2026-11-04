-- CreateEnum
CREATE TYPE "ExitType" AS ENUM ('RESIGNATION', 'TERMINATION', 'END_OF_CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExitStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClearanceArea" AS ENUM ('IT_ADMIN', 'LINE_MANAGER', 'HR', 'FINANCE');

-- CreateEnum
CREATE TYPE "ClearanceStatus" AS ENUM ('WAITING', 'PENDING', 'CLEARED');

-- CreateEnum
CREATE TYPE "SettlementItemKind" AS ENUM ('ASSET_RECOVERY', 'TRAVEL_ADVANCE', 'NOTICE_SHORTFALL', 'LEAVE_ENCASHMENT', 'EXPENSE_PAYABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "SettlementDirection" AS ENUM ('DEDUCT', 'PAY');

-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'RESIGNATION';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "probationEndDate" DATE;

-- CreateTable
CREATE TABLE "ResignationRequest" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "resignationDate" DATE NOT NULL,
    "proposedLastDay" DATE NOT NULL,
    "onProbation" BOOLEAN NOT NULL DEFAULT false,
    "noticeDays" INTEGER NOT NULL,
    "noticeEndDate" DATE NOT NULL,
    "earlyReleaseRecommended" BOOLEAN,

    CONSTRAINT "ResignationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitCase" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "type" "ExitType" NOT NULL,
    "reason" TEXT NOT NULL,
    "requestId" INTEGER,
    "noticeGivenOn" DATE NOT NULL,
    "noticeDays" INTEGER NOT NULL DEFAULT 0,
    "noticeEndDate" DATE,
    "lastWorkingDay" DATE NOT NULL,
    "shortfallDays" INTEGER NOT NULL DEFAULT 0,
    "shortfallWaived" BOOLEAN NOT NULL DEFAULT false,
    "status" "ExitStatus" NOT NULL DEFAULT 'OPEN',
    "startedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancelReason" TEXT,
    "lettersIssuedAt" TIMESTAMP(3),
    "lettersIssuedById" INTEGER,
    "lettersEmailedTo" TEXT,
    "settlementNet" DECIMAL(12,2),
    "settlementPaidOn" DATE,
    "settlementMethod" TEXT,
    "settlementReference" TEXT,
    "settlementNote" TEXT,
    "settledAt" TIMESTAMP(3),
    "settledById" INTEGER,

    CONSTRAINT "ExitCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitClearance" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "area" "ClearanceArea" NOT NULL,
    "status" "ClearanceStatus" NOT NULL,
    "approverId" INTEGER,
    "clearedById" INTEGER,
    "clearedAt" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "ExitClearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitSettlementItem" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "SettlementItemKind" NOT NULL,
    "direction" "SettlementDirection" NOT NULL,
    "description" TEXT NOT NULL,
    "days" DECIMAL(6,1),
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "ExitSettlementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitInterview" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "primaryReason" TEXT NOT NULL,
    "rating" INTEGER,
    "wouldRecommend" BOOLEAN,
    "wouldReturn" BOOLEAN,
    "likedMost" TEXT,
    "improve" TEXT,
    "comments" TEXT,
    "recordedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExitInterview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResignationRequest_requestId_key" ON "ResignationRequest"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ExitCase_requestId_key" ON "ExitCase"("requestId");

-- CreateIndex
CREATE INDEX "ExitCase_employeeId_status_idx" ON "ExitCase"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExitClearance_caseId_area_key" ON "ExitClearance"("caseId", "area");

-- CreateIndex
CREATE UNIQUE INDEX "ExitInterview_caseId_key" ON "ExitInterview"("caseId");

-- AddForeignKey
ALTER TABLE "ResignationRequest" ADD CONSTRAINT "ResignationRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitCase" ADD CONSTRAINT "ExitCase_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitCase" ADD CONSTRAINT "ExitCase_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitCase" ADD CONSTRAINT "ExitCase_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitCase" ADD CONSTRAINT "ExitCase_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitCase" ADD CONSTRAINT "ExitCase_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitCase" ADD CONSTRAINT "ExitCase_lettersIssuedById_fkey" FOREIGN KEY ("lettersIssuedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitCase" ADD CONSTRAINT "ExitCase_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitClearance" ADD CONSTRAINT "ExitClearance_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ExitCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitClearance" ADD CONSTRAINT "ExitClearance_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitClearance" ADD CONSTRAINT "ExitClearance_clearedById_fkey" FOREIGN KEY ("clearedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitSettlementItem" ADD CONSTRAINT "ExitSettlementItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ExitCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitInterview" ADD CONSTRAINT "ExitInterview_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ExitCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitInterview" ADD CONSTRAINT "ExitInterview_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

