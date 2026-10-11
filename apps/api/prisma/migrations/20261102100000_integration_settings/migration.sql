-- Dashboard-managed integration credentials (Settings › Integrations). Values are encrypted by the API before they land here.
CREATE TABLE "IntegrationSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("key")
);
