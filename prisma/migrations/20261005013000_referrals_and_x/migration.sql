-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralBloomGroups" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "referralCoinsAt" TIMESTAMP(3),
ADD COLUMN     "referredAt" TIMESTAMP(3),
ADD COLUMN     "referredById" TEXT,
ADD COLUMN     "vipBoughtAt" TIMESTAMP(3),
ADD COLUMN     "xAvatar" TEXT,
ADD COLUMN     "xId" TEXT,
ADD COLUMN     "xLinkedAt" TIMESTAMP(3),
ADD COLUMN     "xName" TEXT,
ADD COLUMN     "xUsername" TEXT;

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "inviteeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XTaskClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT '',
    "xId" TEXT NOT NULL,
    "coins" INTEGER NOT NULL,
    "proof" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XTaskClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferralReward_userId_createdAt_idx" ON "ReferralReward"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "XTaskClaim_xId_task_target_idx" ON "XTaskClaim"("xId", "task", "target");

-- CreateIndex
CREATE UNIQUE INDEX "XTaskClaim_userId_task_target_key" ON "XTaskClaim"("userId", "task", "target");

-- CreateIndex
CREATE UNIQUE INDEX "User_xId_key" ON "User"("xId");

-- CreateIndex
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XTaskClaim" ADD CONSTRAINT "XTaskClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Players who bought VIP before referrals counted it: their first purchase, from the books.
UPDATE "User" u SET "vipBoughtAt" = c.first
FROM (SELECT "userId", MIN("createdAt") AS first FROM "CurrencyLog" WHERE "reason" = 'buy_vip' GROUP BY "userId") c
WHERE c."userId" = u."id";
