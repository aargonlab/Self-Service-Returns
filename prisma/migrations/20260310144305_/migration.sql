-- AlterTable
ALTER TABLE "ReturnSettings" ADD COLUMN     "logoUrl" TEXT;

-- AlterTable
ALTER TABLE "StoreCreditInstruction" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "boostAmount" SET DATA TYPE DECIMAL(12,2);

-- AddForeignKey
ALTER TABLE "PolicyEvaluation" ADD CONSTRAINT "PolicyEvaluation_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
