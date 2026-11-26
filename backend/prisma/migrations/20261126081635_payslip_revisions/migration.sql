-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "correctedAt" TIMESTAMP(3),
ADD COLUMN     "correctionReason" TEXT;

-- CreateTable
CREATE TABLE "PayslipRevision" (
    "id" SERIAL NOT NULL,
    "payslipId" INTEGER NOT NULL,
    "basicBefore" DECIMAL(12,2) NOT NULL,
    "basicAfter" DECIMAL(12,2) NOT NULL,
    "houseRentBefore" DECIMAL(12,2) NOT NULL,
    "houseRentAfter" DECIMAL(12,2) NOT NULL,
    "medicalBefore" DECIMAL(12,2) NOT NULL,
    "medicalAfter" DECIMAL(12,2) NOT NULL,
    "conveyanceBefore" DECIMAL(12,2) NOT NULL,
    "conveyanceAfter" DECIMAL(12,2) NOT NULL,
    "fuelBefore" DECIMAL(12,2) NOT NULL,
    "fuelAfter" DECIMAL(12,2) NOT NULL,
    "mobileBefore" DECIMAL(12,2) NOT NULL,
    "mobileAfter" DECIMAL(12,2) NOT NULL,
    "grossBefore" DECIMAL(12,2) NOT NULL,
    "grossAfter" DECIMAL(12,2) NOT NULL,
    "incomeTaxBefore" DECIMAL(12,2) NOT NULL,
    "incomeTaxAfter" DECIMAL(12,2) NOT NULL,
    "eobiBefore" DECIMAL(12,2) NOT NULL,
    "eobiAfter" DECIMAL(12,2) NOT NULL,
    "providentFundBefore" DECIMAL(12,2) NOT NULL,
    "providentFundAfter" DECIMAL(12,2) NOT NULL,
    "totalDeductionsBefore" DECIMAL(12,2) NOT NULL,
    "totalDeductionsAfter" DECIMAL(12,2) NOT NULL,
    "netPayBefore" DECIMAL(12,2) NOT NULL,
    "netPayAfter" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayslipRevision_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PayslipRevision" ADD CONSTRAINT "PayslipRevision_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipRevision" ADD CONSTRAINT "PayslipRevision_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
