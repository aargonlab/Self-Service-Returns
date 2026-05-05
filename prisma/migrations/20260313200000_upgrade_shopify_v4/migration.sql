-- Upgrade: @shopify/shopify-app-remix v3 -> v4
-- Add refresh token fields to Session model (required by session-storage-prisma v9)
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "refreshToken" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "refreshTokenExpires" TIMESTAMP(3);

-- Remove inspection feature (cleanup from main branch)
DROP TABLE IF EXISTS "InspectionResult";

-- Remove INSPECTION_PENDING from ReturnStatus enum (idempotent)
DO $$
BEGIN
  -- Check if INSPECTION_PENDING still exists in the enum
  IF EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'INSPECTION_PENDING'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ReturnStatus')
  ) THEN
    -- Update any rows still using the old value
    UPDATE "ReturnRequest" SET "status" = 'RECEIVED' WHERE "status" = 'INSPECTION_PENDING';

    -- Recreate the enum without INSPECTION_PENDING
    ALTER TYPE "ReturnStatus" RENAME TO "ReturnStatus_old";
    CREATE TYPE "ReturnStatus" AS ENUM ('SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'AWAITING_SHIPMENT', 'IN_TRANSIT', 'RECEIVED', 'PARTIALLY_ACCEPTED', 'REFUNDED', 'EXCHANGED', 'CLOSED', 'CANCELLED');
    ALTER TABLE "ReturnRequest" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "ReturnRequest" ALTER COLUMN "status" TYPE "ReturnStatus" USING ("status"::text::"ReturnStatus");
    ALTER TABLE "ReturnRequest" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';
    DROP TYPE "ReturnStatus_old";
  END IF;
END $$;
