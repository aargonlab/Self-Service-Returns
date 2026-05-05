-- DropIndex
DROP INDEX "ReturnRoutingRule_shop_marketId_idx";

-- AlterTable
ALTER TABLE "CustomReason" ADD COLUMN     "requiresShoppingEligibility" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "disclaimerAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "requiresShoppingEligibility" BOOLEAN NOT NULL DEFAULT false;
