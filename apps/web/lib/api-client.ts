import { env } from "./env";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  isFormData?: boolean;
}

/** Reads the (deliberately non-httpOnly) csrf_token cookie the API sets alongside the admin session, so
 * it can be echoed back as a header — a cross-site attacker can't read our cookies to do the same. */
function readCsrfCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match?.[1];
}

// A 401 from any of these means "credentials were wrong" or "not logged in yet", never "session
// expired" — retrying them through a refresh would just waste a round trip on every failed login.
const SKIP_REFRESH_PATHS = [
  "/api/auth/refresh",
  "/api/auth/login",
  "/api/customers/refresh",
  "/api/customers/login",
  "/api/customers/register",
  "/api/customers/verify-otp",
  "/api/customers/google",
];

// Shared across every apiFetch call so several requests failing at once don't each fire their own
// refresh — the API rotates+invalidates the refresh token on each use, so concurrent refreshes would
// cause the second one to look like token reuse and log the session out for real.
let refreshPromise: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    const isAdminRealm = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
    const refreshPath = isAdminRealm ? "/api/auth/refresh" : "/api/customers/refresh";
    refreshPromise = fetch(`${env.apiUrl}${refreshPath}`, { method: "POST", credentials: "include" })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/** Runs client-side (credentials: "include" carries the httpOnly admin/customer cookies to the API).
 * A 401 triggers one silent refresh-and-retry before giving up — the access-token cookie is short-lived
 * (15 min) by design, and callers (useCurrentAdmin/useCurrentCustomer) should only redirect to login
 * once this has already failed. */
export async function apiFetch<T>(path: string, options: RequestOptions = {}, _retried = false): Promise<T> {
  const { method = "GET", body, isFormData = false } = options;
  const csrfToken = method === "GET" ? undefined : readCsrfCookie();

  const res = await fetch(`${env.apiUrl}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  });

  if (res.status === 401 && !_retried && !SKIP_REFRESH_PATHS.some((p) => path.startsWith(p))) {
    const refreshed = await refreshSession();
    if (refreshed) return apiFetch<T>(path, options, true);
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? "Something went wrong", data.details);
  }

  return data as T;
}
