import type { NextFunction, Request, Response } from "express";
import { recordAudit } from "../lib/audit";

const ACTION_BY_METHOD: Record<string, string> = { POST: "create", PATCH: "update", PUT: "update", DELETE: "delete" };

/** Generic audit trail for every admin-authenticated write — no per-route wiring needed. Coarse
 * action label (e.g. "products.create") plus the full path/method in metadata for detail. */
export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const actionVerb = ACTION_BY_METHOD[req.method];
  if (!actionVerb) return next();

  let responseBody: unknown;
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    responseBody = body;
    return originalJson(body);
  }) as typeof res.json;

  res.on("finish", () => {
    if (!req.admin || res.statusCode >= 400) return;

    const entityType = req.baseUrl.split("/").filter(Boolean)[1] ?? "unknown";
    let entityId = (req.params.id as string | undefined) ?? null;
    if (!entityId && responseBody && typeof responseBody === "object") {
      const singularKey = entityType.replace(/s$/, "");
      const nested = (responseBody as Record<string, unknown>)[singularKey] as { id?: string } | undefined;
      entityId = nested?.id ?? null;
    }

    const pathTail = req.path.split("/").filter(Boolean);
    const verb = pathTail[0] === "bulk" ? `bulk_${pathTail[1] ?? actionVerb}` : pathTail.includes("restore") ? "restore" : actionVerb;

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
