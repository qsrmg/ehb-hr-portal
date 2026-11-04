-- AlterTable
ALTER TABLE "RequestStep" ADD COLUMN     "excludePriorApprovers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fallbackLabel" TEXT,
ADD COLUMN     "fallbackRole" "Role";
