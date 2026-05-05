-- DropIndex
DROP INDEX IF EXISTS "CustomReason_shop_code_key";

-- CreateIndex
CREATE INDEX "CustomReason_shop_code_idx" ON "CustomReason"("shop", "code");
