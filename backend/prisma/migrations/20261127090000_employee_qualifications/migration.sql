-- CreateEnum
CREATE TYPE "QualificationRequirement" AS ENUM ('NONE', 'BACHELORS', 'PROFESSIONAL_CERTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "QualificationType" AS ENUM ('BACHELORS', 'HIGHER_DEGREE', 'PROFESSIONAL_CERTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "QualificationEvidenceType" AS ENUM ('DEGREE_CERTIFICATE', 'PROVISIONAL_CERTIFICATE', 'TRANSCRIPT', 'COMPLETION_CERTIFICATE', 'INSTITUTION_VERIFICATION', 'PROFESSIONAL_CERTIFICATION', 'OTHER');

-- AlterTable
ALTER TABLE "Requisition" ADD COLUMN     "minimumQualification" "QualificationRequirement" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "minimumQualificationDetail" TEXT;

-- CreateTable
CREATE TABLE "EmployeeQualification" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "type" "QualificationType" NOT NULL,
    "evidenceType" "QualificationEvidenceType" NOT NULL,
    "institution" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" DATE,
    "documentPath" TEXT,
    "documentName" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" INTEGER,
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeQualification_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "EmployeeQualification" ADD CONSTRAINT "EmployeeQualification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeQualification" ADD CONSTRAINT "EmployeeQualification_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeQualification" ADD CONSTRAINT "EmployeeQualification_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
