-- CreateTable
CREATE TABLE "ActivityPolicyAcknowledgement" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityPolicyAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityExclusion" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "excludedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityDailySummary" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "trackedMinutes" INTEGER NOT NULL DEFAULT 0,
    "activeMinutes" INTEGER NOT NULL DEFAULT 0,
    "idleMinutes" INTEGER NOT NULL DEFAULT 0,
    "pausedMinutesUsed" INTEGER NOT NULL DEFAULT 0,
    "firstActivityAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "processedThroughAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityHeartbeatState" (
    "employeeId" INTEGER NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastRawActivityAt" TIMESTAMP(3),
    "pausedSince" TIMESTAMP(3),

    CONSTRAINT "ActivityHeartbeatState_pkey" PRIMARY KEY ("employeeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivityPolicyAcknowledgement_employeeId_policyVersion_key" ON "ActivityPolicyAcknowledgement"("employeeId", "policyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityExclusion_employeeId_key" ON "ActivityExclusion"("employeeId");

-- CreateIndex
CREATE INDEX "ActivityDailySummary_date_idx" ON "ActivityDailySummary"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityDailySummary_employeeId_date_key" ON "ActivityDailySummary"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "ActivityPolicyAcknowledgement" ADD CONSTRAINT "ActivityPolicyAcknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityExclusion" ADD CONSTRAINT "ActivityExclusion_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityExclusion" ADD CONSTRAINT "ActivityExclusion_excludedById_fkey" FOREIGN KEY ("excludedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityDailySummary" ADD CONSTRAINT "ActivityDailySummary_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityHeartbeatState" ADD CONSTRAINT "ActivityHeartbeatState_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
