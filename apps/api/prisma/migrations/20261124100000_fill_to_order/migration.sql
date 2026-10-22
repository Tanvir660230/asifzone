-- Fill to order (docs/STOCK_HUB.md): attar variants' stock is filled bottles and may go negative; the shop sells
-- max(0, stock) + units the approved recipe can still make. Default false keeps every existing product unchanged.
ALTER TABLE "Product" ADD COLUMN "fillToOrder" BOOLEAN NOT NULL DEFAULT false;
