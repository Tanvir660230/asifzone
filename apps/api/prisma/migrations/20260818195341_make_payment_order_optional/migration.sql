-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "orderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PaymentSession" ADD COLUMN     "checkoutPayload" JSONB,
ALTER COLUMN "orderId" DROP NOT NULL;
