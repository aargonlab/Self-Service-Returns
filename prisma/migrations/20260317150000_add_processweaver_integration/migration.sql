-- CreateTable: ShippingProvider
CREATE TABLE "ShippingProvider" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'ProcessWeaver',
    "apiKey" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'TEST',
    "shipEndpoint" TEXT NOT NULL DEFAULT 'https://shippingapi.processweaver.com/ShippingAPI/Api/Ship',
    "trackEndpoint" TEXT NOT NULL DEFAULT 'https://shippingapi.processweaver.com/TrackAPI/Api/Track',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CarrierAccount
CREATE TABLE "CarrierAccount" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "userId" TEXT,
    "password" TEXT,
    "meterNumber" TEXT,
    "serviceType" TEXT,
    "paymentType" TEXT NOT NULL DEFAULT 'SENDER',
    "shipDateFormat" TEXT NOT NULL DEFAULT 'yyyy-MM-dd',
    "labelFormat" TEXT NOT NULL DEFAULT 'PNG',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierAccount_pkey" PRIMARY KEY ("id")
);

-- AlterTable: ReturnRoutingRule — add carrierAccountId
ALTER TABLE "ReturnRoutingRule" ADD COLUMN "carrierAccountId" TEXT;

-- AlterTable: ReturnShippingLabel — add ProcessWeaver fields
ALTER TABLE "ReturnShippingLabel" ADD COLUMN "carrierCode" TEXT;
ALTER TABLE "ReturnShippingLabel" ADD COLUMN "labelData" TEXT;
ALTER TABLE "ReturnShippingLabel" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MOCK';
ALTER TABLE "ReturnShippingLabel" ADD COLUMN "sinNumber" TEXT;
ALTER TABLE "ReturnShippingLabel" ADD COLUMN "freight" TEXT;
ALTER TABLE "ReturnShippingLabel" ADD COLUMN "trackingEvents" JSONB;
ALTER TABLE "ReturnShippingLabel" ADD COLUMN "lastTrackedAt" TIMESTAMP(3);
ALTER TABLE "ReturnShippingLabel" ADD COLUMN "podSignedBy" TEXT;
ALTER TABLE "ReturnShippingLabel" ADD COLUMN "podDocument" TEXT;

-- CreateIndex: ShippingProvider
CREATE UNIQUE INDEX "ShippingProvider_shop_key" ON "ShippingProvider"("shop");
CREATE INDEX "ShippingProvider_shop_idx" ON "ShippingProvider"("shop");

-- CreateIndex: CarrierAccount
CREATE UNIQUE INDEX "CarrierAccount_shop_carrierCode_name_key" ON "CarrierAccount"("shop", "carrierCode", "name");
CREATE INDEX "CarrierAccount_shop_active_idx" ON "CarrierAccount"("shop", "active");
CREATE INDEX "CarrierAccount_providerId_idx" ON "CarrierAccount"("providerId");

-- CreateIndex: ReturnRoutingRule
CREATE INDEX "ReturnRoutingRule_carrierAccountId_idx" ON "ReturnRoutingRule"("carrierAccountId");

-- CreateIndex: ReturnShippingLabel
CREATE INDEX "ReturnShippingLabel_status_idx" ON "ReturnShippingLabel"("status");

-- AddForeignKey: ReturnRoutingRule -> CarrierAccount
ALTER TABLE "ReturnRoutingRule" ADD CONSTRAINT "ReturnRoutingRule_carrierAccountId_fkey" FOREIGN KEY ("carrierAccountId") REFERENCES "CarrierAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: CarrierAccount -> ShippingProvider
ALTER TABLE "CarrierAccount" ADD CONSTRAINT "CarrierAccount_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ShippingProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
