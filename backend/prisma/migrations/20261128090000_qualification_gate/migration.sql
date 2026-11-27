-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'QUALIFICATION_EXCEPTION';

-- CreateTable
CREATE TABLE "QualificationException" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "requisitionId" INTEGER NOT NULL,
    "requestId" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" INTEGER NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "QualificationException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QualificationException_requestId_key" ON "QualificationException"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationException_employeeId_requisitionId_key" ON "QualificationException"("employeeId", "requisitionId");

-- AddForeignKey
ALTER TABLE "QualificationException" ADD CONSTRAINT "QualificationException_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationException" ADD CONSTRAINT "QualificationException_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationException" ADD CONSTRAINT "QualificationException_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationException" ADD CONSTRAINT "QualificationException_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
