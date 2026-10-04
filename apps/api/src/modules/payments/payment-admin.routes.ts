import { Router } from "express";
import { z } from "zod";
import { paymentLedgerRepairSchema } from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import * as paymentAdminController from "./payment-admin.controller";

const searchQuerySchema = z.object({ phone: z.string().min(4).max(20) });

export const paymentAdminRouter = Router();

paymentAdminRouter.use(requireAdmin);
paymentAdminRouter.get("/overview", requirePermission("payments.read"), paymentAdminController.overview);
paymentAdminRouter.get("/search", requirePermission("payments.read"), validate(searchQuerySchema, "query"), paymentAdminController.search);
// Payment ledger reconciliation (docs/PAYMENT_LEDGER.md §12): read-only drift report; projection repair (OWNER, dry run default).
paymentAdminRouter.get("/ledger/drift", requirePermission("payments.read"), paymentAdminController.ledgerDrift);
paymentAdminRouter.post("/ledger/repair", requirePermission("ops.repair"), validate(paymentLedgerRepairSchema), paymentAdminController.ledgerRepair);
