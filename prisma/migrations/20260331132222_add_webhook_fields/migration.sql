-- AlterTable
ALTER TABLE "ReturnSettings" ADD COLUMN     "webhookActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "webhookSecret" TEXT,
ADD COLUMN     "webhookUrl" TEXT;
