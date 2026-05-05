-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "marketId" TEXT,
ADD COLUMN     "requireManualApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ReturnSettings" ADD COLUMN     "marketReturnWindows" JSONB NOT NULL DEFAULT '[]';
