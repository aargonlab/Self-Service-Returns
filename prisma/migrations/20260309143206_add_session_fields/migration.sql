-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "accountOwner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "collaborator" BOOLEAN DEFAULT false,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "emailVerified" BOOLEAN DEFAULT false,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "locale" TEXT;
