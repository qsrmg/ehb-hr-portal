-- CreateEnum
CREATE TYPE "ExpenseScope" AS ENUM ('LOCAL', 'TRAVEL');

-- CreateEnum
CREATE TYPE "ExpenseLineKind" AS ENUM ('STANDARD', 'HOTEL', 'PER_DIEM', 'MILEAGE');

-- CreateEnum
CREATE TYPE "TravelMode" AS ENUM ('AIR', 'TRAIN', 'BUS', 'COMPANY_CAR', 'OWN_CAR', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('NOT_NEEDED', 'PENDING', 'BOOKED');

-- CreateEnum
CREATE TYPE "BookingKind" AS ENUM ('AIR', 'TRAIN', 'BUS', 'HOTEL');

-- CreateEnum
CREATE TYPE "BookingArranger" AS ENUM ('ADMIN', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "AdvanceReturnMethod" AS ENUM ('CASH_OR_BANK', 'SALARY_DEDUCTION');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CASH';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RequestType" ADD VALUE 'TRAVEL';
ALTER TYPE "RequestType" ADD VALUE 'TRAVEL_SETTLEMENT';

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN     "coveredByPerDiem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scope" "ExpenseScope" NOT NULL DEFAULT 'LOCAL';

-- AlterTable
ALTER TABLE "ExpenseClaim" ADD COLUMN     "travelId" INTEGER;

-- AlterTable
ALTER TABLE "ExpenseLine" ADD COLUMN     "kind" "ExpenseLineKind" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "quantity" DECIMAL(10,2),
ADD COLUMN     "rate" DECIMAL(12,2),
ALTER COLUMN "categoryId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TravelRequest" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'PK',
    "departDate" DATE NOT NULL,
    "returnDate" DATE NOT NULL,
    "mode" "TravelMode" NOT NULL,
    "needsHotel" BOOLEAN NOT NULL DEFAULT false,
    "estimateTransport" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimateHotel" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimateMeals" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimateOther" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimatedTotal" DECIMAL(12,2) NOT NULL,
    "advanceRequested" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "advancePaidOn" DATE,
    "advanceMethod" "PaymentMethod",
    "advanceReference" TEXT,
    "advancePaidAt" TIMESTAMP(3),
    "advancePaidById" INTEGER,
    "advanceReturnedAmount" DECIMAL(12,2),
    "advanceReturnMethod" "AdvanceReturnMethod",
    "advanceReturnedOn" DATE,
    "advanceReturnReference" TEXT,
    "advanceReturnedById" INTEGER,
    "bookingStatus" "BookingStatus" NOT NULL DEFAULT 'NOT_NEEDED',
    "bookedAt" TIMESTAMP(3),
    "bookedById" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "cancellationReason" TEXT,
    "cancellationFee" DECIMAL(12,2),
    "cancellationFeeNote" TEXT,
    "financeNote" TEXT,

    CONSTRAINT "TravelRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelBooking" (
    "id" SERIAL NOT NULL,
    "travelId" INTEGER NOT NULL,
    "kind" "BookingKind" NOT NULL,
    "arrangedBy" "BookingArranger" NOT NULL,
    "details" TEXT NOT NULL,
    "provider" TEXT,
    "reference" TEXT,
    "cost" DECIMAL(12,2),
    "voucherId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TravelRequest_requestId_key" ON "TravelRequest"("requestId");

-- CreateIndex
CREATE INDEX "TravelRequest_departDate_returnDate_idx" ON "TravelRequest"("departDate", "returnDate");

-- CreateIndex
CREATE INDEX "TravelBooking_travelId_idx" ON "TravelBooking"("travelId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseClaim_travelId_key" ON "ExpenseClaim"("travelId");

-- AddForeignKey
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_travelId_fkey" FOREIGN KEY ("travelId") REFERENCES "TravelRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelRequest" ADD CONSTRAINT "TravelRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelRequest" ADD CONSTRAINT "TravelRequest_advancePaidById_fkey" FOREIGN KEY ("advancePaidById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelRequest" ADD CONSTRAINT "TravelRequest_advanceReturnedById_fkey" FOREIGN KEY ("advanceReturnedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelRequest" ADD CONSTRAINT "TravelRequest_bookedById_fkey" FOREIGN KEY ("bookedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelRequest" ADD CONSTRAINT "TravelRequest_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelBooking" ADD CONSTRAINT "TravelBooking_travelId_fkey" FOREIGN KEY ("travelId") REFERENCES "TravelRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelBooking" ADD CONSTRAINT "TravelBooking_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "RequestAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelBooking" ADD CONSTRAINT "TravelBooking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

