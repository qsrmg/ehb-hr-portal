-- CreateTable
CREATE TABLE "PolicyAcknowledgement" (
    "id" SERIAL NOT NULL,
    "policyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "documentId" INTEGER,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAcknowledgement_policyKey_version_employeeId_key" ON "PolicyAcknowledgement"("policyKey", "version", "employeeId");

-- AddForeignKey
ALTER TABLE "PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: copy every existing acknowledgement row into the new shared table. Nothing is deleted or
-- changed in DocumentAcknowledgement / ActivityPolicyAcknowledgement — they stay exactly as they are,
-- so this copy can never lose a row even if it had to be re-run.
INSERT INTO "PolicyAcknowledgement" ("policyKey", "version", "employeeId", "documentId", "acknowledgedAt")
SELECT 'document:' || "documentId", 1, "employeeId", "documentId", "acknowledgedAt"
FROM "DocumentAcknowledgement";

INSERT INTO "PolicyAcknowledgement" ("policyKey", "version", "employeeId", "documentId", "acknowledgedAt")
SELECT 'activity-monitoring', "policyVersion", "employeeId", NULL, "acknowledgedAt"
FROM "ActivityPolicyAcknowledgement";
