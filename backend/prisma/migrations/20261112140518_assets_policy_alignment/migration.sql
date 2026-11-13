-- CreateEnum
CREATE TYPE "RecoveryFinding" AS ENUM ('NEGLIGENCE', 'MISUSE', 'UNAUTHORISED_USE', 'PROCEDURE_VIOLATION', 'WEAR_AND_TEAR');

-- CreateEnum
CREATE TYPE "DisposalReason" AS ENUM ('DISPOSED', 'SOLD', 'REPLACED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "VerificationScope" AS ENUM ('ALL', 'DEPARTMENT', 'CATEGORY');

-- AlterEnum
ALTER TYPE "IncidentStatus" ADD VALUE 'RECOVERY_PENDING_APPROVAL';

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "disposalDate" DATE,
ADD COLUMN     "disposalReason" "DisposalReason";

-- AlterTable
ALTER TABLE "AssetAssignment" ADD COLUMN     "authorisationNote" TEXT;

-- AlterTable
ALTER TABLE "AssetCategory" ADD COLUMN     "dataBearing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transferAuthorisingRole" "Role";

-- AlterTable
ALTER TABLE "AssetIncident" ADD COLUMN     "attachmentFileName" TEXT,
ADD COLUMN     "attachmentMimeType" TEXT,
ADD COLUMN     "attachmentPath" TEXT,
ADD COLUMN     "attachmentSize" INTEGER,
ADD COLUMN     "finding" "RecoveryFinding",
ADD COLUMN     "recoveryApprovedAt" TIMESTAMP(3),
ADD COLUMN     "recoveryApprovedById" INTEGER;

-- CreateTable
CREATE TABLE "AssetAccessory" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "returned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AssetAccessory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVerificationRound" (
    "id" SERIAL NOT NULL,
    "scope" "VerificationScope" NOT NULL,
    "departmentId" INTEGER,
    "categoryId" INTEGER,
    "dueDate" DATE NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "AssetVerificationRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVerificationItem" (
    "id" SERIAL NOT NULL,
    "roundId" INTEGER NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "discrepancyNote" TEXT,

    CONSTRAINT "AssetVerificationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetVerificationItem_roundId_assignmentId_key" ON "AssetVerificationItem"("roundId", "assignmentId");

-- AddForeignKey
ALTER TABLE "AssetAccessory" ADD CONSTRAINT "AssetAccessory_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AssetAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIncident" ADD CONSTRAINT "AssetIncident_recoveryApprovedById_fkey" FOREIGN KEY ("recoveryApprovedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVerificationRound" ADD CONSTRAINT "AssetVerificationRound_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVerificationRound" ADD CONSTRAINT "AssetVerificationRound_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVerificationRound" ADD CONSTRAINT "AssetVerificationRound_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVerificationItem" ADD CONSTRAINT "AssetVerificationItem_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "AssetVerificationRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVerificationItem" ADD CONSTRAINT "AssetVerificationItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AssetAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A2: categories from the Employee Assets Management Policy that were missing from the original seed.
INSERT INTO "AssetCategory" ("name", "kind", "mustReturnOnExit", "dataBearing", "sortOrder") VALUES
  ('Tablet', 'PHYSICAL', true, true, 12),
  ('Storage device', 'PHYSICAL', true, true, 13),
  ('Printer & scanner', 'PHYSICAL', true, false, 14),
  ('Networking equipment', 'PHYSICAL', true, false, 15),
  ('Keys & security devices', 'PHYSICAL', true, false, 16),
  ('Software licence', 'ACCESS', true, false, 17)
ON CONFLICT ("name") DO NOTHING;

-- Cyber Security Incident Response Policy: mark the existing categories that can hold company data, so
-- the IT/Security notification (assets.cyberSecurityNotifyRole) applies to them without further setup.
UPDATE "AssetCategory" SET "dataBearing" = true
WHERE "name" IN ('Laptop', 'Desktop', 'Mobile phone', 'SIM', 'Access card', 'Access & accounts');
