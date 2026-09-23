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
export function getErrorMessage(err: unknown, fallback: string = "Something went wrong"): string {
  if (err instanceof ApiError || err instanceof Error) {
    return err.message || fallback;
  }
  if (err && typeof err === "object") {
    if (
      "type" in err ||
      "target" in err ||
      "srcElement" in err ||
      (err as { constructor?: { name?: string } }).constructor?.name?.includes("Event")
    ) {
      return fallback;
    }
    if ("message" in err && typeof (err as { message: unknown }).message === "string") {
      return (err as { message: string }).message;
    }
  }
  if (typeof err === "string" && err.trim().length > 0) {
    return err;
  }
  return fallback;
}


/** Like getErrorMessage, but for a 400 "Validation failed" it appends the server's per-field messages
 * ("Validation failed: Embroidery Type is required") — those are what tell an admin what to fix. */
export function describeApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const details = err.details as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> } | undefined;
    const fieldMessages = details?.fieldErrors ? Object.values(details.fieldErrors).flat() : [];
    const messages = [...(details?.formErrors ?? []), ...fieldMessages].filter((m): m is string => Boolean(m));
    return messages.length ? `${err.message}: ${messages.slice(0, 3).join("; ")}` : err.message;
  }
  return fallback;
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

/** apiFetch's contract (credentials, CSRF header, one silent session refresh on a 401, ApiError on failure) for a
 * multipart POST — over XHR, because fetch can't report upload progress. `onProgress` gets 0–1 as bytes go out. */
export function apiUploadWithProgress<T>(path: string, body: FormData, onProgress?: (fraction: number) => void, _retried = false): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${env.apiUrl}${path}`);
    xhr.withCredentials = true;
    const csrfToken = readCsrfCookie();
    if (csrfToken) xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = async () => {
      if (xhr.status === 401 && !_retried && (await refreshSession())) {
        apiUploadWithProgress<T>(path, body, onProgress, true).then(resolve, reject);
        return;
      }
      let data: { error?: string; details?: unknown } = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        // non-JSON error page (proxy timeout, too-large body rejected upstream) — fall through to the generic message
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, data.error ?? (xhr.status === 413 ? "File is too large" : "Upload failed"), data.details));
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error — check the connection and retry"));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelled"));
    xhr.send(body);
  });
}
