-- AlterTable
ALTER TABLE "AppRelease" ADD COLUMN     "contentPacks" JSONB NOT NULL DEFAULT '[]';
