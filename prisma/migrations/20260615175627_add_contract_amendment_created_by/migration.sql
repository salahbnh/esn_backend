/*
  Warnings:

  - Added the required column `createdById` to the `ContractAmendment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ContractAmendment" ADD COLUMN     "createdById" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "ContractAmendment_createdById_idx" ON "ContractAmendment"("createdById");

-- AddForeignKey
ALTER TABLE "ContractAmendment" ADD CONSTRAINT "ContractAmendment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
