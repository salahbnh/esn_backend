-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "companySignatoryName" TEXT,
ADD COLUMN     "companySignedAt" TIMESTAMP(3),
ADD COLUMN     "consultantSignatoryName" TEXT,
ADD COLUMN     "consultantSignedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT;
