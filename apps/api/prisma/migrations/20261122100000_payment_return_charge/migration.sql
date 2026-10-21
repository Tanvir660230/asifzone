-- A refused parcel's return charge is kept apart from order money (docs/PAYMENT_LEDGER.md §5a).
CREATE TYPE "PaymentPurpose" AS ENUM ('ORDER', 'RETURN_CHARGE');

ALTER TABLE "Payment" ADD COLUMN "purpose" "PaymentPurpose" NOT NULL DEFAULT 'ORDER';
