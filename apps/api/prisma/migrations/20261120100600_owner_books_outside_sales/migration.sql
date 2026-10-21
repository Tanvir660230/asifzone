-- Owner's books: a courier payout's parcel that was never an order on the site is counted as a sale outside the website.

-- AlterTable
ALTER TABLE "ClearingSettlementLine" ADD COLUMN     "outsideSale" BOOLEAN NOT NULL DEFAULT false;

