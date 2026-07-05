-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'USER';

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "managerId" TEXT;

-- CreateIndex
CREATE INDEX "Contract_managerId_idx" ON "Contract"("managerId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
