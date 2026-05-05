-- AlterTable
ALTER TABLE "ReturnSettings" ADD COLUMN     "webhookEvents" JSONB NOT NULL DEFAULT '["return.submitted","return.approved","return.rejected","return.cancelled","return.status_changed","refund.processed","replacement.processed","disclaimer.accepted"]';
