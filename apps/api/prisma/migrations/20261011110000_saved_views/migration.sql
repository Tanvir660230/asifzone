-- Admin V2 DR-18: saved list views.
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "listKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedView_listKey_adminId_idx" ON "SavedView"("listKey", "adminId");

CREATE INDEX "SavedView_listKey_shared_idx" ON "SavedView"("listKey", "shared");

ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
