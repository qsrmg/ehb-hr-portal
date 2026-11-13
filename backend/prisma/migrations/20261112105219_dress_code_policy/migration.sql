-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'RELIGIOUS_ACCOMMODATION';

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "dressCodeNotes" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DocumentAcknowledgement" (
    "id" SERIAL NOT NULL,
    "documentId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAcknowledgement_documentId_employeeId_key" ON "DocumentAcknowledgement"("documentId", "employeeId");

-- AddForeignKey
ALTER TABLE "DocumentAcknowledgement" ADD CONSTRAINT "DocumentAcknowledgement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAcknowledgement" ADD CONSTRAINT "DocumentAcknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
