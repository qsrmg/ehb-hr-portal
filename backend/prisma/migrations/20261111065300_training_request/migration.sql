-- CreateEnum
CREATE TYPE "TrainingType" AS ENUM ('COURSE', 'WORKSHOP', 'CONFERENCE', 'CERTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "TrainingMode" AS ENUM ('ONLINE', 'ON_SITE');

-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'TRAINING';

-- CreateTable
CREATE TABLE "TrainingRequest" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "programmeTitle" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "trainingType" "TrainingType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "mode" "TrainingMode" NOT NULL,
    "location" TEXT,
    "estimatedCost" DECIMAL(12,2) NOT NULL,
    "justification" TEXT NOT NULL,

    CONSTRAINT "TrainingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingRequest_requestId_key" ON "TrainingRequest"("requestId");

-- AddForeignKey
ALTER TABLE "TrainingRequest" ADD CONSTRAINT "TrainingRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
