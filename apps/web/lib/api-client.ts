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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  isFormData?: boolean;
}

/** Runs client-side (credentials: "include" carries the httpOnly admin cookies to the API). */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, isFormData = false } = options;

  const res = await fetch(`${env.apiUrl}${path}`, {
    method,
    credentials: "include",
    headers: isFormData ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? "Something went wrong", data.details);
  }

  return data as T;
}
