-- CreateEnum
CREATE TYPE "ExitChecklistItemStatus" AS ENUM ('PENDING', 'DONE', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "ExitClearance" ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "pendingSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExitChecklistTemplate" (
    "id" SERIAL NOT NULL,
    "area" "ClearanceArea" NOT NULL,
    "label" TEXT NOT NULL,
    "ownerRole" "Role",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExitChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExitChecklistItem" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "templateId" INTEGER,
    "area" "ClearanceArea" NOT NULL,
    "label" TEXT NOT NULL,
    "ownerRole" "Role",
    "status" "ExitChecklistItemStatus" NOT NULL DEFAULT 'PENDING',
    "doneById" INTEGER,
    "doneAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "ExitChecklistItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ExitChecklistItem" ADD CONSTRAINT "ExitChecklistItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ExitCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitChecklistItem" ADD CONSTRAINT "ExitChecklistItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExitChecklistTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExitChecklistItem" ADD CONSTRAINT "ExitChecklistItem_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every clearance card already PENDING on an OPEN case gets a pendingSince (the case's own
-- createdAt, the closest we have to "when this card became pending") and lastReminderAt = now(), so the
-- first run of the new reminder job does not send a burst of reminders for cases that have been open for
-- a while already. Cards that are WAITING or CLEARED are untouched (status <> 'PENDING' already excludes
-- Finance's WAITING card and anything already cleared).
UPDATE "ExitClearance" c
SET "pendingSince" = e."createdAt", "lastReminderAt" = now()
FROM "ExitCase" e
WHERE c."caseId" = e."id" AND e."status" = 'OPEN' AND c."status" = 'PENDING';

-- Starter offboarding checklist templates (placeholder wording; see DECISIONS.md — HR/Admin to confirm
-- the actual wording). Guarded so this never duplicates if the migration is ever re-applied.
INSERT INTO "ExitChecklistTemplate" ("area", "label", "ownerRole", "sortOrder", "active")
SELECT * FROM (VALUES
  ('IT_ADMIN'::"ClearanceArea", 'Laptop and accessories returned', 'ADMIN'::"Role", 1, true),
  ('IT_ADMIN'::"ClearanceArea", 'Company email, VPN and system access revoked', 'ADMIN'::"Role", 2, true),
  ('LINE_MANAGER'::"ClearanceArea", 'Work handed over to the team', 'LINE_MANAGER'::"Role", 1, true),
  ('LINE_MANAGER'::"ClearanceArea", 'Access to shared project documents reviewed', 'LINE_MANAGER'::"Role", 2, true),
  ('HR'::"ClearanceArea", 'Exit interview offered', NULL::"Role", 1, true),
  ('HR'::"ClearanceArea", 'Personnel file closed out', NULL::"Role", 2, true),
  ('FINANCE'::"ClearanceArea", 'Outstanding advances and claims reviewed', 'FINANCE'::"Role", 1, true),
  ('FINANCE'::"ClearanceArea", 'Final settlement documents filed', 'FINANCE'::"Role", 2, true)
) AS seed("area", "label", "ownerRole", "sortOrder", "active")
WHERE NOT EXISTS (SELECT 1 FROM "ExitChecklistTemplate");
