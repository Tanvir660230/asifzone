import { Router, type Request, type Response } from "express";
import { quoteRequestSchema, type QuoteRequestInput } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { attachCustomerIfPresent } from "../../middlewares/require-customer";
import { attachAdminIfPresent } from "../../middlewares/require-admin";
import { quoteRateLimit } from "../../middlewares/rate-limit";
import { asyncHandler } from "../../lib/async-handler";
import { bestCouponFor, quoteCart, toQuoteDto, type QuoteRequest } from "../../domain/pricing/pricing.service";

/** /api/v1/checkout — the first versioned API surface (TARGET_ARCHITECTURE §13). */
export const checkoutV1Router = Router();

/** The client sends what to price — variant ids, quantities, coupon code, address — never a price. A `customerId`
 * is honoured only for an admin session (the admin "Create order" page); a shopper is identified by their cookie. */
function toRequest(req: Request): QuoteRequest {
  const body = req.body as QuoteRequestInput;
  const address = body.shippingDistrict || body.shippingDivision || body.shippingPostcode
    ? { district: body.shippingDistrict ?? null, division: body.shippingDivision ?? null, postcode: body.shippingPostcode ?? null }
    : null;
  return {
    items: body.items,
    couponCode: body.couponCode ?? null,
    address,
    customerId: req.admin && body.customerId ? body.customerId : (req.customer?.customerId ?? null),
  };
}

checkoutV1Router.post(
  "/quote",
  quoteRateLimit,
  attachCustomerIfPresent,
  attachAdminIfPresent,
  validate(quoteRequestSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ quote: toQuoteDto(await quoteCart(toRequest(req))) });
  }),
);

/** The same quote with the best coupon this cart already qualifies for applied (null when none helps). */
checkoutV1Router.post(
  "/quote/best-coupon",
  quoteRateLimit,
  attachCustomerIfPresent,
  attachAdminIfPresent,
  validate(quoteRequestSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const best = await bestCouponFor(toRequest(req));
    res.json({ quote: best ? toQuoteDto(best) : null });
  }),
);
