-- AlterTable
ALTER TABLE "AppRelease" ADD COLUMN     "deltas" JSONB NOT NULL DEFAULT '[]';
