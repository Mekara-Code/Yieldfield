-- CreateTable
CREATE TABLE "AppRelease" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "versionCode" INTEGER NOT NULL,
    "versionName" TEXT NOT NULL,
    "notes" TEXT,
    "url" TEXT NOT NULL,
    "size" INTEGER,
    "storage" TEXT NOT NULL DEFAULT 'link',
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "AppRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppRelease_platform_versionCode_idx" ON "AppRelease"("platform", "versionCode");
