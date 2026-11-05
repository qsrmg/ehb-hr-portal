-- AlterEnum
ALTER TYPE "ScorecardStage" ADD VALUE 'APPEAL';

-- AlterTable
ALTER TABLE "RatingAdjustment" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'CALIBRATION';

-- AlterTable
ALTER TABLE "Scorecard" ADD COLUMN     "appealChanged" BOOLEAN,
ADD COLUMN     "appealDecidedAt" TIMESTAMP(3),
ADD COLUMN     "appealDecidedById" INTEGER,
ADD COLUMN     "appealDecision" TEXT,
ADD COLUMN     "appealReason" TEXT,
ADD COLUMN     "appealedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_appealDecidedById_fkey" FOREIGN KEY ("appealDecidedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

