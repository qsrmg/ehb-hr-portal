-- AlterTable
ALTER TABLE "AssetAssignment" ADD COLUMN     "retainedAt" TIMESTAMP(3),
ADD COLUMN     "retainedById" INTEGER,
ADD COLUMN     "retainedNote" TEXT;

-- AddForeignKey
ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_retainedById_fkey" FOREIGN KEY ("retainedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
