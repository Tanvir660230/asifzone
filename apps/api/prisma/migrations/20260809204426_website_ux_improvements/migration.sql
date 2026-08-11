-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "shortDescription" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "callEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "callLabel" TEXT NOT NULL DEFAULT 'Call Us',
ADD COLUMN     "liveChatEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "liveChatLabel" TEXT NOT NULL DEFAULT 'Live Chat',
ADD COLUMN     "tawkPropertyId" TEXT,
ADD COLUMN     "tawkWidgetId" TEXT,
ADD COLUMN     "whatsappLabel" TEXT NOT NULL DEFAULT 'WhatsApp',
ADD COLUMN     "whatsappMessage" TEXT;

-- CreateTable
CREATE TABLE "PaymentMethodOption" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethodOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMethodOption_isActive_sortOrder_idx" ON "PaymentMethodOption"("isActive", "sortOrder");
