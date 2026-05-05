/*
  Warnings:

  - A unique constraint covering the columns `[returnRequestId,shopifyLineItemId]` on the table `ReturnItem` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "ProcessedWebhook" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessedWebhook_createdAt_idx" ON "ProcessedWebhook"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnItem_returnRequestId_shopifyLineItemId_key" ON "ReturnItem"("returnRequestId", "shopifyLineItemId");
