import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { resolveCartLines } from "../orders/cart-lines";
import * as couponService from "./coupon.service";

export const validate = asyncHandler(async (req: Request, res: Response) => {
  const { code, subtotal, items } = req.body;
  const cartLines = items?.length ? (await resolveCartLines(items)).lines : undefined;
  const { coupon, discount, freeShipping, eligibleProductIds } = await couponService.evaluateCoupon(code, subtotal, {
    cartLines,
    customerId: req.customer?.customerId,
  });
  res.json({ code: coupon.code, type: coupon.type, value: coupon.value, discount, freeShipping, eligibleProductIds });
});

export const active = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ coupons: await couponService.listActiveCoupons() });
});

export const best = asyncHandler(async (req: Request, res: Response) => {
  const { subtotal, items } = req.body;
  const cartLines = items?.length ? (await resolveCartLines(items)).lines : undefined;
  const match = await couponService.findBestCoupon(subtotal, cartLines);
  res.json({
    result: match
      ? {
          code: match.coupon.code,
          type: match.coupon.type,
          value: match.coupon.value,
          discount: match.discount,
          freeShipping: match.freeShipping,
        }
      : null,
  });
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
