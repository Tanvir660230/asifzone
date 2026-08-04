import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as couponService from "./coupon.service";

export const validate = asyncHandler(async (req: Request, res: Response) => {
  const { code, subtotal } = req.body;
  const { coupon, discount } = await couponService.evaluateCoupon(code, subtotal);
  res.json({ code: coupon!.code, type: coupon!.type, value: coupon!.value, discount });
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
