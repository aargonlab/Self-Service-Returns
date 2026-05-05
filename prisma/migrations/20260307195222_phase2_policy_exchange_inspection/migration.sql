-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('ELIGIBILITY', 'AUTO_ACTION', 'EXCLUSION', 'REQUIREMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReturnStatus" ADD VALUE 'INSPECTION_PENDING';
ALTER TYPE "ReturnStatus" ADD VALUE 'PARTIALLY_ACCEPTED';
ALTER TYPE "ReturnStatus" ADD VALUE 'EXCHANGED';
ALTER TYPE "ReturnStatus" ADD VALUE 'STORE_CREDIT_ISSUED';

-- AlterTable
ALTER TABLE "ReturnSettings" ADD COLUMN     "enableExchange" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enableStoreCredit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storeCreditBoost" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReturnPolicy" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "PolicyType" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "outcome" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyEvaluation" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT,
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "results" JSONB NOT NULL,
    "finalOutcome" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,

    CONSTRAINT "PolicyEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeInstruction" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "shopifyNewOrderId" TEXT,
    "exchangeItems" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCreditInstruction" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "shopifyGiftCardId" TEXT,
    "code" TEXT,
    "boostPercentage" INTEGER NOT NULL DEFAULT 0,
    "boostAmount" DECIMAL(10,2),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "issuedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCreditInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionResult" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "returnItemId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "inspectorNotes" TEXT,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectedBy" TEXT NOT NULL,

    CONSTRAINT "InspectionResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnPolicy_shop_type_active_idx" ON "ReturnPolicy"("shop", "type", "active");

-- CreateIndex
CREATE INDEX "ReturnPolicy_shop_priority_idx" ON "ReturnPolicy"("shop", "priority");

-- CreateIndex
CREATE INDEX "PolicyEvaluation_returnRequestId_idx" ON "PolicyEvaluation"("returnRequestId");

-- CreateIndex
CREATE INDEX "PolicyEvaluation_shop_evaluatedAt_idx" ON "PolicyEvaluation"("shop", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeInstruction_returnRequestId_key" ON "ExchangeInstruction"("returnRequestId");

-- CreateIndex
CREATE INDEX "ExchangeInstruction_returnRequestId_idx" ON "ExchangeInstruction"("returnRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCreditInstruction_returnRequestId_key" ON "StoreCreditInstruction"("returnRequestId");

-- CreateIndex
CREATE INDEX "StoreCreditInstruction_returnRequestId_idx" ON "StoreCreditInstruction"("returnRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionResult_returnItemId_key" ON "InspectionResult"("returnItemId");

-- CreateIndex
CREATE INDEX "InspectionResult_returnRequestId_idx" ON "InspectionResult"("returnRequestId");

-- CreateIndex
CREATE INDEX "InspectionResult_returnItemId_idx" ON "InspectionResult"("returnItemId");

-- AddForeignKey
ALTER TABLE "ExchangeInstruction" ADD CONSTRAINT "ExchangeInstruction_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCreditInstruction" ADD CONSTRAINT "StoreCreditInstruction_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionResult" ADD CONSTRAINT "InspectionResult_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionResult" ADD CONSTRAINT "InspectionResult_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "ReturnItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
