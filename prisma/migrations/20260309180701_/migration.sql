-- AlterTable
ALTER TABLE "ReturnItem" ADD COLUMN     "shopifyVariantId" TEXT;

-- CreateTable
CREATE TABLE "ReturnShippingLabel" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL DEFAULT 'DHL Express',
    "trackingNumber" TEXT NOT NULL,
    "trackingUrl" TEXT,
    "labelUrl" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "warehouseAddress" JSONB NOT NULL,
    "customerAddress" JSONB NOT NULL,
    "weight" TEXT,
    "dimensions" TEXT,
    "estimatedDelivery" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnShippingLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReturnShippingLabel_returnRequestId_key" ON "ReturnShippingLabel"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnShippingLabel_returnRequestId_idx" ON "ReturnShippingLabel"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnShippingLabel_trackingNumber_idx" ON "ReturnShippingLabel"("trackingNumber");

-- AddForeignKey
ALTER TABLE "ReturnShippingLabel" ADD CONSTRAINT "ReturnShippingLabel_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
