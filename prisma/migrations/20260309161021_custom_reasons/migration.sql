-- AlterTable
ALTER TABLE "ReturnItem" ALTER COLUMN "returnReason" TYPE TEXT;

-- DropEnum
DROP TYPE "ReturnReason";

-- CreateTable
CREATE TABLE "CustomReason" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "appliesToReturn" BOOLEAN NOT NULL DEFAULT true,
    "appliesToExchange" BOOLEAN NOT NULL DEFAULT false,
    "requiresNote" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "markets" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomReason_shop_code_key" ON "CustomReason"("shop", "code");

-- CreateIndex
CREATE INDEX "CustomReason_shop_active_idx" ON "CustomReason"("shop", "active");
