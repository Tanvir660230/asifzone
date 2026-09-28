import type { Request, Response } from "express";
import { toMajor } from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/app-error";
import { bestCouponFor, quoteCart } from "../../domain/pricing/pricing.service";
import * as couponService from "./coupon.service";

/** Coupon preview, answered by the canonical quote (the client's `subtotal`, if sent, is ignored — never trusted). */
export const validate = asyncHandler(async (req: Request, res: Response) => {
  const { code, items } = req.body as { code: string; items?: Array<{ variantId: string; quantity: number }> };
  if (!items?.length) throw AppError.badRequest("This coupon can't be applied without your cart details");
  const { quote } = await quoteCart({ items, couponCode: code, customerId: req.customer?.customerId ?? null });
  const rejected = quote.rejectedPromotions.find((r) => r.kind === "COUPON");
  if (rejected || !quote.coupon) throw AppError.badRequest(rejected?.message ?? "Coupon not found");
  const coupon = await couponService.getCouponByCode(quote.coupon.code);
  res.json({
    code: quote.coupon.code,
    type: quote.coupon.type,
    value: coupon?.value ?? null,
    discount: toMajor(quote.coupon.discount),
    freeShipping: quote.coupon.freeShipping,
    eligibleProductIds: quote.coupon.eligibleProductIds,
  });
});

export const active = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ coupons: await couponService.listActiveCoupons() });
});

/** Best coupon suggestion — the same engine and the same stacking (after the bundle) as checkout. */
export const best = asyncHandler(async (req: Request, res: Response) => {
  const { items } = req.body as { items?: Array<{ variantId: string; quantity: number }> };
  if (!items?.length) return res.json({ result: null });
  const priced = await bestCouponFor({ items, customerId: req.customer?.customerId ?? null });
  const c = priced?.quote.coupon;
  const coupon = c ? await couponService.getCouponByCode(c.code) : null;
  res.json({ result: c ? { code: c.code, type: c.type, value: coupon?.value ?? null, discount: toMajor(c.discount), freeShipping: c.freeShipping } : null });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await couponService.listCoupons(req.query as never));
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ coupon: await couponService.getCouponById(req.params.id!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const coupon = await couponService.createCoupon(req.body);
  res.status(201).json({ coupon });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ coupon: await couponService.updateCoupon(req.params.id!, req.body) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await couponService.deleteCoupon(req.params.id!);
  res.status(204).send();
});

export const restore = asyncHandler(async (req: Request, res: Response) => {
  res.json({ coupon: await couponService.restoreCoupon(req.params.id!) });
});

export const permanentlyRemove = asyncHandler(async (req: Request, res: Response) => {
  await couponService.permanentlyDeleteCoupon(req.params.id!);
  res.status(204).send();
});
