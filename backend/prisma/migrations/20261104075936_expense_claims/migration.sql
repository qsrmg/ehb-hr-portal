-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'WITH_SALARY');

-- CreateEnum
CREATE TYPE "ExpenseLineStatus" AS ENUM ('CLAIMED', 'REDUCED', 'REJECTED');

-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'EXPENSE';

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "accountingCode" TEXT,
    "monthlyLimit" DECIMAL(12,2),
    "allowanceWarning" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseClaim" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "totalClaimed" DECIMAL(12,2) NOT NULL,
    "paidOn" DATE,
    "paymentMethod" "PaymentMethod",
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" INTEGER,

    CONSTRAINT "ExpenseClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseLine" (
    "id" SERIAL NOT NULL,
    "claimId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "ExpenseLineStatus" NOT NULL DEFAULT 'CLAIMED',
    "approvedAmount" DECIMAL(12,2),
    "financeReason" TEXT,
    "noReceiptExplanation" TEXT,
    "allowanceJustification" TEXT,
    "receiptId" INTEGER,

    CONSTRAINT "ExpenseLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseClaim_requestId_key" ON "ExpenseClaim"("requestId");

-- CreateIndex
CREATE INDEX "ExpenseLine_claimId_idx" ON "ExpenseLine"("claimId");

-- CreateIndex
CREATE INDEX "ExpenseLine_date_idx" ON "ExpenseLine"("date");

-- AddForeignKey
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExpenseClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLine" ADD CONSTRAINT "ExpenseLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "RequestAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Default expense categories (HR / Finance can edit them, add accounting codes and monthly limits)
INSERT INTO "ExpenseCategory" ("name", "allowanceWarning", "sortOrder") VALUES
  ('Local travel', false, 1),
  ('Fuel', true, 2),
  ('Meals & entertainment', false, 3),
  ('Client meeting', false, 4),
  ('Office supplies', false, 5),
  ('Communication / Mobile', true, 6),
  ('Courier & postage', false, 7),
  ('Other', false, 8);
