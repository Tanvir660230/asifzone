import { apiFetch } from "../api-client";

/** Monthly targets (apps/api/src/modules/targets): a store-local month's targets with the month so far. */
export type TargetStatus = "ahead" | "on-track" | "behind" | "met" | "missed" | "no-target";

export interface TargetProgress {
  target: number | null;
  actual: number;
  percentDone: number | null;
  expectedByToday: number | null;
  projected: number;
  status: TargetStatus;
}

export interface MonthTargets {
  month: string;
  currency: string;
  daysInMonth: number;
  elapsedDays: number;
  finished: boolean;
  netSales: TargetProgress;
  orders: TargetProgress;
  /** Null for an admin who can't read the books. */
  profit: TargetProgress | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface MonthTargetsInput {
  netSales?: number | null;
  orders?: number | null;
  profit?: number | null;
}

export const targetsKeys = {
  all: ["targets"] as const,
  month: (month: string) => ["targets", month] as const,
};

export function getMonthTargets(month: string) {
  return apiFetch<MonthTargets>(`/api/targets/${month}`);
}

export function setMonthTargets(month: string, input: MonthTargetsInput) {
  return apiFetch<MonthTargets>(`/api/targets/${month}`, { method: "PUT", body: input });
}

/** "2026-11" for a date in the store's own calendar (the browser's local date is the store's in practice). */
export function monthOf(date: Date = new Date()): string {
  return date.toLocaleDateString("en-CA").slice(0, 7);
}

export type ScorecardStatus = "good" | "watch" | "bad" | "neutral";

export interface ScorecardFigure {
  key: string;
  label: string;
  unit: "money" | "count" | "ratio" | "times";
  value: number | null;
  previous: number | null;
  target: number | null;
  status: ScorecardStatus;
  rule: string;
}

export interface Scorecard {
  month: string;
  currency: string;
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  figures: ScorecardFigure[];
  money: { cash: number; owedToYou: number; youOwe: number; stock: number } | null;
}

export const scorecardKey = (month: string) => ["targets", month, "scorecard"] as const;

export function getScorecard(month: string) {
  return apiFetch<Scorecard>(`/api/targets/${month}/scorecard`);
}
