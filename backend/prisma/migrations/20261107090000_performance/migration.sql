-- CreateEnum
CREATE TYPE "PerformanceCycleStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ScorecardStage" AS ENUM ('GOAL_SETTING', 'GOALS_WITH_EMPLOYEE', 'GOALS_APPROVAL', 'ACTIVE', 'MANAGER_REVIEW', 'SIGN_OFF', 'COMPLETED', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "BscPerspective" AS ENUM ('FINANCIAL', 'CUSTOMER', 'INTERNAL_PROCESS', 'LEARNING_GROWTH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RequestType" ADD VALUE 'PERFORMANCE_GOALS';
ALTER TYPE "RequestType" ADD VALUE 'PERFORMANCE_REVIEW';

-- CreateTable
CREATE TABLE "PerformanceCycle" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "goalsDueDate" DATE NOT NULL,
    "checkInDate" DATE,
    "reviewOpensDate" DATE NOT NULL,
    "reviewDueDate" DATE NOT NULL,
    "status" "PerformanceCycleStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PerformanceCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scorecard" (
    "id" SERIAL NOT NULL,
    "cycleId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "stage" "ScorecardStage" NOT NULL DEFAULT 'GOAL_SETTING',
    "goalsSetById" INTEGER,
    "goalsSentAt" TIMESTAMP(3),
    "goalsAcknowledgedAt" TIMESTAMP(3),
    "employeeGoalComment" TEXT,
    "goalsRequestId" INTEGER,
    "selfSubmittedAt" TIMESTAMP(3),
    "selfComment" TEXT,
    "reviewedById" INTEGER,
    "managerSubmittedAt" TIMESTAMP(3),
    "managerComment" TEXT,
    "reviewRequestId" INTEGER,
    "finalScore" DECIMAL(4,2),
    "finalBand" TEXT,
    "completedAt" TIMESTAMP(3),
    "employeeAckAt" TIMESTAMP(3),
    "employeeAckComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardKpi" (
    "id" SERIAL NOT NULL,
    "scorecardId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "perspective" "BscPerspective" NOT NULL,
    "title" TEXT NOT NULL,
    "measure" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "actual" TEXT,
    "selfRating" INTEGER,
    "selfComment" TEXT,
    "managerRating" INTEGER,
    "managerComment" TEXT,
    "finalRating" INTEGER,

    CONSTRAINT "ScorecardKpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardCheckIn" (
    "id" SERIAL NOT NULL,
    "scorecardId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScorecardCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatingAdjustment" (
    "id" SERIAL NOT NULL,
    "scorecardId" INTEGER NOT NULL,
    "kpiId" INTEGER NOT NULL,
    "fromRating" INTEGER NOT NULL,
    "toRating" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "byId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatingAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceTemplate" (
    "id" SERIAL NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "kpis" JSONB NOT NULL,
    "updatedById" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_goalsRequestId_key" ON "Scorecard"("goalsRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_reviewRequestId_key" ON "Scorecard"("reviewRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_cycleId_employeeId_key" ON "Scorecard"("cycleId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceTemplate_departmentId_key" ON "PerformanceTemplate"("departmentId");

-- AddForeignKey
ALTER TABLE "PerformanceCycle" ADD CONSTRAINT "PerformanceCycle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_goalsSetById_fkey" FOREIGN KEY ("goalsSetById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_goalsRequestId_fkey" FOREIGN KEY ("goalsRequestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_reviewRequestId_fkey" FOREIGN KEY ("reviewRequestId") REFERENCES "Request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardKpi" ADD CONSTRAINT "ScorecardKpi_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "Scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardCheckIn" ADD CONSTRAINT "ScorecardCheckIn_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "Scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardCheckIn" ADD CONSTRAINT "ScorecardCheckIn_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingAdjustment" ADD CONSTRAINT "RatingAdjustment_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "Scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingAdjustment" ADD CONSTRAINT "RatingAdjustment_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "ScorecardKpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingAdjustment" ADD CONSTRAINT "RatingAdjustment_byId_fkey" FOREIGN KEY ("byId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceTemplate" ADD CONSTRAINT "PerformanceTemplate_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceTemplate" ADD CONSTRAINT "PerformanceTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

