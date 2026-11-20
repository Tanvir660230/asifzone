-- A payment link for just the delivery charge, sent by staff to a customer with a history of refused parcels before the
-- order is booked; the courier then collects the rest (modules/payments/payment-link.service.ts).
ALTER TYPE "PaymentLinkPurpose" ADD VALUE 'DELIVERY_ADVANCE';
