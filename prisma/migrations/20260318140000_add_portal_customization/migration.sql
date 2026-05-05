-- Add portal customization fields to ReturnSettings
ALTER TABLE "ReturnSettings" ADD COLUMN IF NOT EXISTS "portalLogoPosition" TEXT NOT NULL DEFAULT 'left';
ALTER TABLE "ReturnSettings" ADD COLUMN IF NOT EXISTS "portalButtonColor" TEXT;
ALTER TABLE "ReturnSettings" ADD COLUMN IF NOT EXISTS "portalButtonTextColor" TEXT;
ALTER TABLE "ReturnSettings" ADD COLUMN IF NOT EXISTS "portalTextColor" TEXT;
ALTER TABLE "ReturnSettings" ADD COLUMN IF NOT EXISTS "portalHeadingFont" TEXT NOT NULL DEFAULT 'sans-serif';
ALTER TABLE "ReturnSettings" ADD COLUMN IF NOT EXISTS "portalBodyFont" TEXT NOT NULL DEFAULT 'sans-serif';

-- Add enableSerialNumbers and excludeReplacementForRxGroup if missing
ALTER TABLE "ReturnSettings" ADD COLUMN IF NOT EXISTS "enableSerialNumbers" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ReturnSettings" ADD COLUMN IF NOT EXISTS "excludeReplacementForRxGroup" BOOLEAN NOT NULL DEFAULT false;

-- Add serial number fields to ReturnItem
ALTER TABLE "ReturnItem" ADD COLUMN IF NOT EXISTS "serialNumber" TEXT;
ALTER TABLE "ReturnItem" ADD COLUMN IF NOT EXISTS "sapLineId" TEXT;

-- Drop the old unique constraint on ReturnItem (returnRequestId, shopifyLineItemId) if it exists
-- and add the new one that includes serialNumber
DROP INDEX IF EXISTS "ReturnItem_returnRequestId_shopifyLineItemId_key";
DROP INDEX IF EXISTS "ReturnItem_returnRequestId_shopifyLineItemId_serialNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ReturnItem_returnRequestId_serialNumber_key" ON "ReturnItem"("returnRequestId", "serialNumber");

-- Drop the old unique constraint on ReturnRoutingRule (shop, marketId, shippingMethod) if it exists
-- and replace with (shop, marketId)
DROP INDEX IF EXISTS "ReturnRoutingRule_shop_marketId_shippingMethod_key";
DROP INDEX IF EXISTS "ReturnRoutingRule_shop_marketId_key";
CREATE UNIQUE INDEX "ReturnRoutingRule_shop_marketId_key" ON "ReturnRoutingRule"("shop", "marketId");

-- CreateTable: SerialNumber (if not exists)
CREATE TABLE IF NOT EXISTS "SerialNumber" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "lineItemId" TEXT NOT NULL,
    "variantId" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "imageUrl" TEXT,
    "sapLineId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "returnItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SerialNumber_pkey" PRIMARY KEY ("id")
);

-- Create indexes for SerialNumber (if not exist)
CREATE UNIQUE INDEX IF NOT EXISTS "SerialNumber_shop_orderId_serialNumber_key" ON "SerialNumber"("shop", "orderId", "serialNumber");
CREATE INDEX IF NOT EXISTS "SerialNumber_shop_orderId_idx" ON "SerialNumber"("shop", "orderId");
CREATE INDEX IF NOT EXISTS "SerialNumber_shop_lineItemId_idx" ON "SerialNumber"("shop", "lineItemId");
CREATE INDEX IF NOT EXISTS "SerialNumber_returnItemId_idx" ON "SerialNumber"("returnItemId");
CREATE INDEX IF NOT EXISTS "SerialNumber_status_idx" ON "SerialNumber"("status");
CREATE INDEX IF NOT EXISTS "SerialNumber_shop_orderId_status_idx" ON "SerialNumber"("shop", "orderId", "status");
