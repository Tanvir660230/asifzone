import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validate";
import { clientReportRateLimit } from "../../middlewares/rate-limit";
import { captureError } from "../../lib/observability/error-capture";

/** Site health: POST /api/v1/client-errors — the storefront and admin browsers report their own crashes here
 * (apps/web/lib/report-client-error.ts), so they show up in Admin › System health next to the server's errors.
 *
 * Public by design, like the analytics beacons: sent with navigator.sendBeacon (no CSRF header possible), bounded in
 * size, rate-limited per visitor, and all it can do is add a masked row to the error list. Replies 204 with no body. */

const clientErrorSchema = z.object({
  message: z.string().min(1).max(500),
  stack: z.string().max(4000).optional(),
  digest: z.string().max(64).optional(),
  path: z.string().min(1).max(300).startsWith("/"),
  kind: z.enum(["boundary", "unhandled"]),
});

class ClientError extends Error {
  constructor(message: string, stack: string | undefined) {
    super(message);
    this.name = "ClientError";
    this.stack = stack ? `ClientError: ${message}\n${stack.split("\n").slice(1).join("\n")}` : `ClientError: ${message}`;
  }
}

export const clientErrorsRouter = Router();
clientErrorsRouter.post("/", clientReportRateLimit, validate(clientErrorSchema), (req, res) => {
  const body = req.body as z.infer<typeof clientErrorSchema>;
  captureError(new ClientError(body.message, body.stack), { source: "web", path: body.path, digest: body.digest, kind: body.kind });
  res.status(204).end();
});
