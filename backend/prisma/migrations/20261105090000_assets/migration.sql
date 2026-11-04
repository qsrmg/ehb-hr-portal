-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('PHYSICAL', 'ACCESS');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_STOCK', 'ISSUED', 'IN_REPAIR', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "AssigneeType" AS ENUM ('EMPLOYEE', 'DEPARTMENT', 'LOCATION');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('NOT_WORKING', 'DAMAGED', 'LOST');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('REPORTED', 'RECORDED', 'RECOVERY_SET', 'WRITTEN_OFF', 'CLOSED');

-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'ASSET_REQUEST';

-- CreateTable
CREATE TABLE "AssetCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL DEFAULT 'PHYSICAL',
    "mustReturnOnExit" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" SERIAL NOT NULL,
    "tag" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "serialNumber" TEXT,
    "purchaseDate" DATE,
    "cost" DECIMAL(12,2),
    "warrantyUntil" DATE,
    "condition" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "storageLocation" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAssignment" (
    "id" SERIAL NOT NULL,
    "assetId" INTEGER NOT NULL,
    "assigneeType" "AssigneeType" NOT NULL,
    "employeeId" INTEGER,
    "departmentId" INTEGER,
    "location" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" INTEGER NOT NULL,
    "conditionOut" "AssetCondition" NOT NULL,
    "issueNote" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "receivedById" INTEGER,
    "conditionIn" "AssetCondition",
    "returnNote" TEXT,

    CONSTRAINT "AssetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetRepair" (
    "id" SERIAL NOT NULL,
    "assetId" INTEGER NOT NULL,
    "vendor" TEXT NOT NULL,
    "sentOn" DATE NOT NULL,
    "returnedOn" DATE,
    "cost" DECIMAL(12,2),
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetRepair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetIncident" (
    "id" SERIAL NOT NULL,
    "assetId" INTEGER NOT NULL,
    "assignmentId" INTEGER,
    "employeeId" INTEGER,
    "type" "IncidentType" NOT NULL,
    "status" "IncidentStatus" NOT NULL,
    "description" TEXT NOT NULL,
    "reportedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" INTEGER,
    "recordedAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "recoveryAmount" DECIMAL(12,2),
    "recoverySetById" INTEGER,
    "recoverySetAt" TIMESTAMP(3),
    "recoveryNote" TEXT,
    "writtenOffById" INTEGER,
    "writtenOffAt" TIMESTAMP(3),
    "writeOffNote" TEXT,

    CONSTRAINT "AssetIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetRequest" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "neededBy" DATE,
    "assignmentId" INTEGER,

    CONSTRAINT "AssetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetCategory_name_key" ON "AssetCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tag_key" ON "Asset"("tag");

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "Asset_categoryId_idx" ON "Asset"("categoryId");

-- CreateIndex
CREATE INDEX "AssetAssignment_employeeId_returnedAt_idx" ON "AssetAssignment"("employeeId", "returnedAt");

-- CreateIndex
CREATE INDEX "AssetAssignment_assetId_returnedAt_idx" ON "AssetAssignment"("assetId", "returnedAt");

-- CreateIndex
CREATE INDEX "AssetIncident_status_idx" ON "AssetIncident"("status");

-- CreateIndex
CREATE INDEX "AssetIncident_employeeId_idx" ON "AssetIncident"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetRequest_requestId_key" ON "AssetRequest"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetRequest_assignmentId_key" ON "AssetRequest"("assignmentId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRepair" ADD CONSTRAINT "AssetRepair_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRepair" ADD CONSTRAINT "AssetRepair_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIncident" ADD CONSTRAINT "AssetIncident_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIncident" ADD CONSTRAINT "AssetIncident_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AssetAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIncident" ADD CONSTRAINT "AssetIncident_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIncident" ADD CONSTRAINT "AssetIncident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIncident" ADD CONSTRAINT "AssetIncident_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIncident" ADD CONSTRAINT "AssetIncident_recoverySetById_fkey" FOREIGN KEY ("recoverySetById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIncident" ADD CONSTRAINT "AssetIncident_writtenOffById_fkey" FOREIGN KEY ("writtenOffById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRequest" ADD CONSTRAINT "AssetRequest_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AssetAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

