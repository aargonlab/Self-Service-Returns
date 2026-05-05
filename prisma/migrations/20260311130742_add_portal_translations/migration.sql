-- AlterTable
ALTER TABLE "CustomReason" ADD COLUMN     "translations" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "PortalTranslation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalTranslation_shop_active_idx" ON "PortalTranslation"("shop", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PortalTranslation_shop_locale_key" ON "PortalTranslation"("shop", "locale");
