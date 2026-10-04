import { apiFetch } from "../api-client";

/** The reusable metrics API (docs/METRICS_REGISTRY.md §5). Every value is computed by the server's metrics engine; the
 * web only renders it — no summing, averaging or percentage-change math in the browser. */
export interface MetricsResponse {
  range: { from: string; to: string; startUtc: string; endUtc: string; timezone: string; preset: string | null };
  currency: string;
  metrics: Record<string, { value: number; unit: "money" | "count" | "ratio"; estimated?: boolean; coverage?: { recorded: number; missing: number } }>;
  groups?: Array<{ key: string; label: string; metrics: Record<string, number> }>;
  previous?: { range: { from: string; to: string }; metrics: Record<string, number>; changePct: Record<string, number | null> };
}

export interface MetricsParams {
  metrics: string[];
  preset?: string;
  /** Inclusive business dates, YYYY-MM-DD. */
  from?: string;
  to?: string;
  groupBy?: "day" | "month" | "year" | "payment_method" | "product" | "category" | "brand" | "customer";
  limit?: number;
  compare?: "previous";
}

export function getMetrics(params: MetricsParams) {
  const q = new URLSearchParams({ metrics: params.metrics.join(",") });
  if (params.preset) q.set("preset", params.preset);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.groupBy) q.set("groupBy", params.groupBy);
  if (params.limit) q.set("limit", String(params.limit));
  if (params.compare) q.set("compare", params.compare);
  return apiFetch<MetricsResponse>(`/api/v1/metrics?${q.toString()}`);
}

/** A date the admin picked in the range picker, as the calendar date they picked (YYYY-MM-DD) — the server resolves it in
 * the store timezone. */
export function pickedDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
