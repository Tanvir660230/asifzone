import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { listDoorSwaps } from "./door-swap.service";

/** The Exchanges board (Orders › Exchanges): door swaps across all orders. */
export const doorSwapRouter = Router();
doorSwapRouter.get(
  "/",
  requireAdmin,
  requirePermission("orders.read"),
  asyncHandler(async (req, res) => {
    res.json({ items: await listDoorSwaps(req.query.filter === "all" ? "all" : "open") });
  }),
);
