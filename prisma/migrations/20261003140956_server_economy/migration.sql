-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bloom" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gems" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CurrencyLog" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "change" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CurrencyLog_userId_createdAt_idx" ON "CurrencyLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CurrencyLog" ADD CONSTRAINT "CurrencyLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BLOOM bought or granted so far (the farm's credits, net of what was spent on the server) becomes the
-- player's BLOOM balance, kept on the server from now on.
UPDATE "User" AS u SET "bloom" = GREATEST(f."credits", 0) FROM "Farm" AS f WHERE f."userId" = u."id";
