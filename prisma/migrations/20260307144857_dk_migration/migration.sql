-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'AWAITING_SHIPMENT', 'IN_TRANSIT', 'RECEIVED', 'REFUNDED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResolutionType" AS ENUM ('REFUND', 'STORE_CREDIT', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('DOESNT_FIT', 'NOT_AS_DESCRIBED', 'ARRIVED_DAMAGED', 'WRONG_ITEM', 'CHANGED_MIND', 'QUALITY_NOT_EXPECTED', 'OTHER');

-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('NEW_WITH_TAGS', 'NEW_WITHOUT_TAGS', 'USED', 'DAMAGED');

-- CreateEnum
CREATE TYPE "AuthorType" AS ENUM ('CUSTOMER', 'AGENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyOrderName" TEXT NOT NULL,
    "shopifyReturnId" TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'SUBMITTED',
    "resolutionType" "ResolutionType",
    "returnWindow" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "imageUrl" TEXT,
    "price" TEXT,
    "quantity" INTEGER NOT NULL,
    "returnReason" "ReturnReason" NOT NULL,
    "returnCondition" "ReturnCondition",
    "customerNote" TEXT,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnAttachment" (
    "id" TEXT NOT NULL,
    "returnItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnComment" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorType" "AuthorType" NOT NULL,
    "content" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnTimeline" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorType" "AuthorType" NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "returnWindowDays" INTEGER NOT NULL DEFAULT 30,
    "allowedReasons" JSONB NOT NULL DEFAULT '[]',
    "returnInstructions" TEXT,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnRequest_shop_status_idx" ON "ReturnRequest"("shop", "status");

-- CreateIndex
CREATE INDEX "ReturnRequest_shop_customerEmail_idx" ON "ReturnRequest"("shop", "customerEmail");

-- CreateIndex
CREATE INDEX "ReturnRequest_shopifyOrderId_idx" ON "ReturnRequest"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "ReturnRequest_createdAt_idx" ON "ReturnRequest"("createdAt");

-- CreateIndex
CREATE INDEX "ReturnItem_returnRequestId_idx" ON "ReturnItem"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnAttachment_returnItemId_idx" ON "ReturnAttachment"("returnItemId");

-- CreateIndex
CREATE INDEX "ReturnComment_returnRequestId_idx" ON "ReturnComment"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnTimeline_returnRequestId_idx" ON "ReturnTimeline"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnTimeline_createdAt_idx" ON "ReturnTimeline"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnSettings_shop_key" ON "ReturnSettings"("shop");

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnAttachment" ADD CONSTRAINT "ReturnAttachment_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "ReturnItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnComment" ADD CONSTRAINT "ReturnComment_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnTimeline" ADD CONSTRAINT "ReturnTimeline_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
