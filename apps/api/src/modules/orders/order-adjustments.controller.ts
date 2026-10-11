import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { prisma } from "../../config/prisma";
import { idempotencyKeyOf } from "./order.controller";
import { applyOrderModification, listOrderModifications, previewOrderModification, type ModificationActor } from "./order-modification.service";
import { cancelOwnOrder, listItemReturns, previewItemReturn, recordItemReturn } from "./order-adjustments.service";
import { creditRefundDueToStore, getOrderPaymentSummary } from "../../domain/payments/payment-ledger.service";
import { getStoreCreditSummary } from "../../domain/credit/customer-credit.service";
import { getCurrency } from "../../domain/config/commerce-settings";
import {
  cancelPaymentLink,
  createPaymentLink,
  listPaymentLinks,
  sendPaymentLink,
  startModificationPayment,
  startPaymentLink,
  viewPaymentLink,
} from "../payments/payment-link.service";

// docs/ORDER_ADJUSTMENTS.md — HTTP edges only; every rule lives in the services.

const admin = (req: Request): ModificationActor => ({ type: "ADMIN", adminId: req.admin!.adminId });
const customer = (req: Request): ModificationActor => ({ type: "CUSTOMER", customerId: req.customer!.customerId });
/** A customer never sets the admin-only switch. */
const customerBody = (req: Request) => ({ ...req.body, collectDifferenceLater: undefined });

// --- admin -----------------------------------------------------------------------------------

export const adminPreviewModification = asyncHandler(async (req: Request, res: Response) => {
  res.json({ preview: await previewOrderModification(req.params.id!, req.body, admin(req)) });
});

export const adminApplyModification = asyncHandler(async (req: Request, res: Response) => {
  const result = await applyOrderModification(req.params.id!, req.body, admin(req), idempotencyKeyOf(req));
  res.status(201).json({ ...result, payment: await getOrderPaymentSummary(req.params.id!) });
});

export const adminListModifications = asyncHandler(async (req: Request, res: Response) => {
  res.json({ modifications: await listOrderModifications(req.params.id!) });
});

export const adminRecordReturn = asyncHandler(async (req: Request, res: Response) => {
  const request = await recordItemReturn(req.params.id!, req.body, req.admin!.adminId, idempotencyKeyOf(req));
  res.status(201).json({ returnRequest: request, payment: await getOrderPaymentSummary(req.params.id!) });
});

export const adminPreviewReturn = asyncHandler(async (req: Request, res: Response) => {
  res.json({ preview: await previewItemReturn(req.params.id!, req.body) });
});

export const adminListReturns = asyncHandler(async (req: Request, res: Response) => {
  res.json({ returns: await listItemReturns(req.params.id!) });
});

export const adminCreditToStore = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await creditRefundDueToStore(req.params.id!, req.body, req.admin!.adminId, idempotencyKeyOf(req)));
});

export const adminCreatePaymentLink = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ link: await createPaymentLink(req.params.id!, req.body, req.admin!.adminId) });
});

export const adminListPaymentLinks = asyncHandler(async (req: Request, res: Response) => {
  res.json({ links: await listPaymentLinks(req.params.id!) });
});

export const adminCancelPaymentLink = asyncHandler(async (req: Request, res: Response) => {
  res.json({ link: await cancelPaymentLink(req.params.id!, req.params.linkId!, req.admin!.adminId) });
});

export const adminSendPaymentLink = asyncHandler(async (req: Request, res: Response) => {
  res.json({ link: await sendPaymentLink(req.params.id!, req.params.linkId!, req.body.channels, req.admin!.adminId) });
});

export const adminCustomerStoreCredit = asyncHandler(async (req: Request, res: Response) => {
  res.json({ storeCredit: await getStoreCreditSummary(req.params.id!, await getCurrency(), { limit: 100 }) });
});

// --- customer (own orders only) --------------------------------------------------------------

export const myStoreCredit = asyncHandler(async (req: Request, res: Response) => {
  res.json({ storeCredit: await getStoreCreditSummary(req.customer!.customerId, await getCurrency()) });
});

export const myPreviewModification = asyncHandler(async (req: Request, res: Response) => {
  res.json({ preview: await previewOrderModification(req.params.id!, customerBody(req), customer(req)) });
});

export const myApplyModification = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await applyOrderModification(req.params.id!, customerBody(req), customer(req), idempotencyKeyOf(req)));
});

export const myListModifications = asyncHandler(async (req: Request, res: Response) => {
  // Ownership is checked by the preview/apply services; the history read checks it here.
  const order = await prisma.order.findUnique({ where: { id: req.params.id! }, select: { customerId: true, deletedAt: true } });
  if (!order || order.deletedAt || order.customerId !== req.customer!.customerId) return res.status(404).json({ error: "Order not found" });
  res.json({ modifications: await listOrderModifications(req.params.id!) });
});

export const myPayModification = asyncHandler(async (req: Request, res: Response) => {
  const { gatewayUrl } = await startModificationPayment(req.customer!.customerId, req.params.id!, req.params.modId!, req.body.provider, req.ip);
  res.json({ gatewayUrl });
});

export const myCancelOrder = asyncHandler(async (req: Request, res: Response) => {
  res.json(await cancelOwnOrder(req.customer!.customerId, req.params.id!, req.body));
});

// --- public payment link ----------------------------------------------------------------------

export const viewLink = asyncHandler(async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ link: await viewPaymentLink(req.params.token!) });
});

export const startLink = asyncHandler(async (req: Request, res: Response) => {
  const { gatewayUrl } = await startPaymentLink(req.params.token!, req.body.provider, req.ip);
  res.json({ gatewayUrl });
});
