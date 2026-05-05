-- CreateTable
CREATE TABLE "ReturnWarehouse" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address1" TEXT NOT NULL,
    "address2" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT,
    "zip" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "countryCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnWarehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRoutingRule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "marketId" TEXT,
    "marketName" TEXT,
    "warehouseId" TEXT NOT NULL,
    "carrier" TEXT,
    "shippingMethod" TEXT NOT NULL DEFAULT 'standard',
    "returnInstructions" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnWarehouse_shop_active_idx" ON "ReturnWarehouse"("shop", "active");

-- CreateIndex
CREATE INDEX "ReturnWarehouse_shop_isDefault_idx" ON "ReturnWarehouse"("shop", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRoutingRule_shop_marketId_shippingMethod_key" ON "ReturnRoutingRule"("shop", "marketId", "shippingMethod");

-- CreateIndex
CREATE INDEX "ReturnRoutingRule_shop_active_idx" ON "ReturnRoutingRule"("shop", "active");

-- CreateIndex
CREATE INDEX "ReturnRoutingRule_shop_marketId_idx" ON "ReturnRoutingRule"("shop", "marketId");

-- CreateIndex
CREATE INDEX "ReturnRoutingRule_warehouseId_idx" ON "ReturnRoutingRule"("warehouseId");

-- AddForeignKey
ALTER TABLE "ReturnRoutingRule" ADD CONSTRAINT "ReturnRoutingRule_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "ReturnWarehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
