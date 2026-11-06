-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "probationNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProbationDecision" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "previousProbationEndDate" DATE,
    "newProbationEndDate" DATE,
    "reason" TEXT,
    "decidedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProbationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProbationNote" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProbationNote_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProbationDecision" ADD CONSTRAINT "ProbationDecision_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationDecision" ADD CONSTRAINT "ProbationDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationNote" ADD CONSTRAINT "ProbationNote_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbationNote" ADD CONSTRAINT "ProbationNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

