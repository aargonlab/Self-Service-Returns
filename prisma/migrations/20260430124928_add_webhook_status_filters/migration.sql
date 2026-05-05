-- AlterTable
ALTER TABLE "ReturnSettings" ADD COLUMN     "webhookStatusFilters" JSONB NOT NULL DEFAULT '[]';
