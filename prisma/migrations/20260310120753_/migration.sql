-- DropIndex
DROP INDEX "InspectionResult_returnItemId_idx";

-- CreateIndex
CREATE INDEX "ApiKey_shop_active_idx" ON "ApiKey"("shop", "active");

-- CreateIndex
CREATE INDEX "ReturnRequest_shopifyReturnId_idx" ON "ReturnRequest"("shopifyReturnId");

-- CreateIndex
CREATE INDEX "ReturnRequest_shopifyOrderName_idx" ON "ReturnRequest"("shopifyOrderName");

-- CreateIndex
CREATE INDEX "ReturnRequest_customerEmail_idx" ON "ReturnRequest"("customerEmail");

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "Session_expires_idx" ON "Session"("expires");
