import { app } from "./app";

/** Every Express route with its real middleware chain (names), walked from the running router stack — so router-level
 * `.use(requireAdmin)` ordering is accounted for exactly as Express applies it. Test helper (Phase 10 authorization). */
export interface RouteInfo {
  method: string;
  path: string;
  chain: string[];
}

type Layer = { name: string; handle: { name?: string; stack?: Layer[] } & ((...a: never[]) => unknown); route?: { path: string; methods: Record<string, boolean>; stack: Layer[] }; regexp?: RegExp };

function mountPath(layer: Layer): string {
  const src = (layer.regexp?.source ?? "").replace(/\\\//g, "/");
  const m = src.match(/^\^(.*?)\/\?\(\?=\/\|\$\)/);
  return m ? m[1]! : "";
}

export function listRoutes(): RouteInfo[] {
  const out: RouteInfo[] = [];
  const walk = (stack: Layer[], prefix: string, inherited: string[]) => {
    const chain = [...inherited];
    for (const layer of stack) {
      if (layer.route) {
        const names = layer.route.stack.map((l) => l.handle.name || "anonymous");
        for (const method of Object.keys(layer.route.methods)) out.push({ method: method.toUpperCase(), path: prefix + layer.route.path, chain: [...chain, ...names] });
      } else if (layer.name === "router" && layer.handle.stack) {
        walk(layer.handle.stack, prefix + mountPath(layer), chain);
      } else if (prefix) {
        chain.push(layer.handle.name || "anonymous");
      }
    }
  };
  walk((app as unknown as { _router: { stack: Layer[] } })._router.stack, "", []);
  return out;
}

/** The permission a route requires (`requirePermission(x)`), "(self)" for requireSelf, or null for a non-admin route. */
export function routePermission(route: RouteInfo): string | null {
  if (!route.chain.includes("requireAdmin")) return null;
  const perm = route.chain.map((n) => n.match(/^requirePermission\((.+)\)$/)?.[1]).find(Boolean);
  return perm ?? (route.chain.includes("requireSelf") ? "(self)" : "(none)");
}
