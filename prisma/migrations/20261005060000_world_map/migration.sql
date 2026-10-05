-- CreateTable
CREATE TABLE "MapFarm" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "biome" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "produce" JSONB NOT NULL DEFAULT '{}',
    "storedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shieldUntil" TIMESTAMP(3),
    "takenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapFarm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapChunk" (
    "cx" INTEGER NOT NULL,
    "cy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapChunk_pkey" PRIMARY KEY ("cx","cy")
);

-- CreateTable
CREATE TABLE "Battle" (
    "id" TEXT NOT NULL,
    "attackerId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "defenderId" TEXT,
    "win" BOOLEAN NOT NULL,
    "log" JSONB NOT NULL,
    "choice" TEXT,
    "loot" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Battle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MapFarm_nameKey_key" ON "MapFarm"("nameKey");

-- CreateIndex
CREATE INDEX "MapFarm_ownerId_idx" ON "MapFarm"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "MapFarm_x_y_key" ON "MapFarm"("x", "y");

-- CreateIndex
CREATE INDEX "Battle_attackerId_createdAt_idx" ON "Battle"("attackerId", "createdAt");

-- CreateIndex
CREATE INDEX "Battle_defenderId_createdAt_idx" ON "Battle"("defenderId", "createdAt");

-- CreateIndex
CREATE INDEX "Battle_farmId_createdAt_idx" ON "Battle"("farmId", "createdAt");

-- AddForeignKey
ALTER TABLE "MapFarm" ADD CONSTRAINT "MapFarm_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Battle" ADD CONSTRAINT "Battle_attackerId_fkey" FOREIGN KEY ("attackerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

