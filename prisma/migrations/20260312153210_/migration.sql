/*
  Warnings:

  - The values [STORE_CREDIT] on the enum `ResolutionType` will be removed. If these variants are still used in the database, this will fail.
  - The values [STORE_CREDIT_ISSUED] on the enum `ReturnStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `enableStoreCredit` on the `ReturnSettings` table. All the data in the column will be lost.
  - You are about to drop the column `storeCreditBoost` on the `ReturnSettings` table. All the data in the column will be lost.
  - You are about to drop the `StoreCreditInstruction` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ResolutionType_new" AS ENUM ('REFUND', 'EXCHANGE');
ALTER TABLE "ReturnRequest" ALTER COLUMN "resolutionType" TYPE "ResolutionType_new" USING ("resolutionType"::text::"ResolutionType_new");
ALTER TYPE "ResolutionType" RENAME TO "ResolutionType_old";
ALTER TYPE "ResolutionType_new" RENAME TO "ResolutionType";
DROP TYPE "ResolutionType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ReturnStatus_new" AS ENUM ('SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'AWAITING_SHIPMENT', 'IN_TRANSIT', 'RECEIVED', 'INSPECTION_PENDING', 'PARTIALLY_ACCEPTED', 'REFUNDED', 'EXCHANGED', 'CLOSED', 'CANCELLED');
ALTER TABLE "ReturnRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ReturnRequest" ALTER COLUMN "status" TYPE "ReturnStatus_new" USING ("status"::text::"ReturnStatus_new");
ALTER TYPE "ReturnStatus" RENAME TO "ReturnStatus_old";
ALTER TYPE "ReturnStatus_new" RENAME TO "ReturnStatus";
DROP TYPE "ReturnStatus_old";
ALTER TABLE "ReturnRequest" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';
COMMIT;

-- DropForeignKey
ALTER TABLE "StoreCreditInstruction" DROP CONSTRAINT "StoreCreditInstruction_returnRequestId_fkey";

-- AlterTable
ALTER TABLE "ReturnSettings" DROP COLUMN "enableStoreCredit",
DROP COLUMN "storeCreditBoost";

-- DropTable
DROP TABLE "StoreCreditInstruction";
