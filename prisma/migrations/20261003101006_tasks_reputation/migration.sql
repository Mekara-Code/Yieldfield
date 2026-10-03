-- AlterTable
ALTER TABLE "Animal" ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reputation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vipUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DailyTasks" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "tasks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyTasks_pkey" PRIMARY KEY ("userId","day")
);

-- CreateTable
CREATE TABLE "TaskClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL,
    "reputation" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskClaim_userId_createdAt_idx" ON "TaskClaim"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskClaim_userId_day_taskId_key" ON "TaskClaim"("userId", "day", "taskId");

-- AddForeignKey
ALTER TABLE "DailyTasks" ADD CONSTRAINT "DailyTasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskClaim" ADD CONSTRAINT "TaskClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
