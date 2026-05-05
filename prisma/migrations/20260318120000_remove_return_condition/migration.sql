-- AlterTable: Remove returnCondition column from ReturnItem
ALTER TABLE "ReturnItem" DROP COLUMN IF EXISTS "returnCondition";

-- DropEnum: Remove ReturnCondition enum type
DROP TYPE IF EXISTS "ReturnCondition";
