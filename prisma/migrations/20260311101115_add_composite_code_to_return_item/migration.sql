-- AlterTable
ALTER TABLE "ReturnItem" ADD COLUMN     "compositeCode" TEXT;

-- Backfill existing return items with composite codes based on parent request's resolutionType
UPDATE "ReturnItem" ri
SET "compositeCode" = CASE
    WHEN rr."resolutionType" = 'EXCHANGE' THEN 'REP-' || ri."returnReason"
    ELSE 'RET-' || ri."returnReason"
END
FROM "ReturnRequest" rr
WHERE ri."returnRequestId" = rr.id;
