import { serverRuntimeConfig } from "@/lib/runtime-config";

/**
 * Uploaded media at the same origin as the storefront (Phase 1B). In production nginx serves `/uploads/` straight from the
 * installation's uploads volume and requests never reach this route; it answers when nothing sits in front of the web app
 * (local development, a bare `next start`) and for next/image's own server-side fetch of a same-origin `/uploads/…` src.
 * It streams the file from the API's static uploads mount over the internal URL — read-only, GET/HEAD only.
 */
async function proxy(req: Request, { params }: { params: Promise<{ path: string[] }> }, method: "GET" | "HEAD") {
  const { path } = await params;
  if (path.some((segment) => segment === ".." || segment === "." || segment.includes("\\"))) {
    return new Response("Not found", { status: 404 });
  }
  const upstream = await fetch(`${serverRuntimeConfig().apiInternalUrl}/uploads/${path.map(encodeURIComponent).join("/")}`, {
    method,
    headers: req.headers.get("if-none-match") ? { "if-none-match": req.headers.get("if-none-match")! } : undefined,
    cache: "no-store",
  }).catch(() => null);
  if (!upstream) return new Response("Upstream unavailable", { status: 502 });

  const headers = new Headers();
  for (const name of ["content-type", "content-length", "etag", "last-modified", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}

export function GET(req: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(req, context, "GET");
}

export function HEAD(req: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxy(req, context, "HEAD");
}
