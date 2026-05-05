-- CreateTable
CREATE TABLE "RefundAgent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "addedBy" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundOtp" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundSession" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundAgent_shop_active_idx" ON "RefundAgent"("shop", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RefundAgent_shop_email_key" ON "RefundAgent"("shop", "email");

-- CreateIndex
CREATE INDEX "RefundOtp_shop_email_used_idx" ON "RefundOtp"("shop", "email", "used");

-- CreateIndex
CREATE INDEX "RefundOtp_expiresAt_idx" ON "RefundOtp"("expiresAt");

-- CreateIndex
CREATE INDEX "RefundSession_shop_email_idx" ON "RefundSession"("shop", "email");

-- CreateIndex
CREATE INDEX "RefundSession_token_idx" ON "RefundSession"("token");

-- CreateIndex
CREATE INDEX "RefundSession_expiresAt_idx" ON "RefundSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefundSession_token_key" ON "RefundSession"("token");
