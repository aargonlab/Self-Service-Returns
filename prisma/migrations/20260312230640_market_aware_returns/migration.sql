-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN "windowOverride" INTEGER;

-- AlterTable
ALTER TABLE "CustomReason" ADD COLUMN "replacementExcludedMarkets" JSONB NOT NULL DEFAULT '[]';
