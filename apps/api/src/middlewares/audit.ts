import type { NextFunction, Request, Response } from "express";
import { recordAudit } from "../lib/audit";

const ACTION_BY_METHOD: Record<string, string> = { POST: "create", PATCH: "update", PUT: "update", DELETE: "delete" };

/** Generic audit trail for every admin-authenticated write — no per-route wiring needed. Coarse
 * action label (e.g. "products.create") plus the full path/method in metadata for detail. */
/** Bulk data leaving the system (orders / products / analytics CSV) — a read, but audited like a write (Phase 10, G-7). */
const EXPORT_PATH = /\/export\//;

/** The area a write touched: the first path segment after /api (and after /v1 and its /admin group) — "/api/orders/x"
 * → "orders", "/api/v1/outbox/x/retry" → "outbox", "/api/v1/admin/views" → "views". */
export function auditEntityType(baseUrl: string, path: string): string {
  const parts = `${baseUrl}${path}`.split("/").filter(Boolean);
  let i = parts[0] === "api" ? 1 : 0;
  if (parts[i] === "v1") i += 1;
  if (parts[i] === "admin" && parts[i + 1]) i += 1;
  return parts[i] ?? "unknown";
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const isExport = req.method === "GET" && EXPORT_PATH.test(req.path);
  const actionVerb = isExport ? "export" : ACTION_BY_METHOD[req.method];
  if (!actionVerb) return next();

  let responseBody: unknown;
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    responseBody = body;
    return originalJson(body);
  }) as typeof res.json;

  res.on("finish", () => {
    // A handler that records its own, more specific audit events (see product.service) opts out of the generic row.
    if (!req.admin || res.statusCode >= 400 || res.locals.auditHandled) return;

    const entityType = auditEntityType(req.baseUrl, req.path);
    let entityId = (req.params.id as string | undefined) ?? null;
    if (!entityId && responseBody && typeof responseBody === "object") {
      const singularKey = entityType.replace(/s$/, "");
      const nested = (responseBody as Record<string, unknown>)[singularKey] as { id?: string } | undefined;
      // `{ product: {...} }` envelopes, or the created resource itself at the top level (`{ id, ... }`).
      const top = (responseBody as { id?: unknown }).id;
      entityId = nested?.id ?? (typeof top === "string" ? top : null);
    }

    const pathTail = req.path.split("/").filter(Boolean);
    const verb = isExport ? "export" : pathTail[0] === "bulk" ? `bulk_${pathTail[1] ?? actionVerb}` : pathTail.includes("restore") ? "restore" : actionVerb;

    recordAudit({
      adminId: req.admin.adminId,
      action: `${entityType}.${verb}`,
      entityType,
      entityId,
      ipAddress: req.ip ?? null,
      metadata: { method: req.method, path: req.originalUrl },
    });
  });

  next();
}
