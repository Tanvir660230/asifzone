import { cookies } from "next/headers";
import { QueryClient, dehydrate, type DehydratedState } from "@tanstack/react-query";
import { apiBaseUrl } from "@/lib/runtime-config";

/**
 * Blueprint V2 P9 (performance): every admin page waits for "who am I" (/api/auth/me) and the provider capabilities
 * before its permission-gated queries can start. Fetching both here, on the server, with the admin's own cookie, hands
 * them to React Query already filled in — the browser skips that round trip. Best effort: no cookie, an expired token,
 * a slow or failing API all return null and the client fetches as before. Keys and shapes match useCurrentAdmin and
 * useProviderCapabilities.
 */
const TIMEOUT_MS = 1500;

async function getJson(path: string, cookie: string): Promise<unknown> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    headers: { cookie },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

export async function prefetchAdminSession(): Promise<DehydratedState | null> {
  const token = (await cookies()).get("access_token")?.value;
  if (!token) return null;
  const cookie = `access_token=${token}`;
  const [me, capabilities] = await Promise.allSettled([getJson("/api/auth/me", cookie), getJson("/api/v1/ops/capabilities", cookie)]);
  if (me.status !== "fulfilled") return null;
  const queryClient = new QueryClient();
  queryClient.setQueryData(["current-admin"], me.value);
  if (capabilities.status === "fulfilled") queryClient.setQueryData(["provider-capabilities"], capabilities.value);
  return dehydrate(queryClient);
}
