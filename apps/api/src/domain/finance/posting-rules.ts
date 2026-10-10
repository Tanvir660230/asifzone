/**
 * The posting-rule registry of the accounting event inbox (Financial Core Phase 1 §5, extended in Phase 3): one rule per
 * (event type, version). A rule turns an event payload into journal lines that name MAPPING KEYS — never account ids in
 * code — and, since Phase 3, may name earlier events it supersedes. The only consumer is events.service processFinancialEvent.
 */
import type { FinancialEvent } from "@prisma/client";
import type { ZodType } from "zod";
import { financialEventHandlerKey, type AccountMappingKey } from "@clothing-brand/shared";
import type { FinanceBusinessInfo } from "./finance-context";
import type { JournalLineSpec } from "./journal.service";

export interface PostingRuleLine {
  /** A mapping key (preferred — never an account id in code) or, for rules that carry it in the payload, an account id. */
  account: AccountMappingKey | { accountId: string };
  /** Minor units. */
  debit: number;
  credit: number;
  memo?: string | null;
  partyType?: string | null;
  partyId?: string | null;
  valuationStatus?: JournalLineSpec["valuationStatus"];
}

export type PostingRuleResult =
  | { ignore: string }
  | {
      description: string;
      reference?: string | null;
      lines: PostingRuleLine[];
      /** Phase 3: ids of earlier FinancialEvents this one replaces (a corrected or vanished fact) — undone before posting. */
      reverses?: string[];
    };

export interface PostingRule<P = Record<string, unknown>> {
  payload: ZodType<P>;
  build(payload: P, ctx: { event: FinancialEvent; business: FinanceBusinessInfo }): PostingRuleResult;
}

export const RULES = new Map<string, PostingRule<never>>();

/** Registers the posting rule for one event type at one version. A version is never re-registered with other behaviour. */
export function registerPostingRule<P>(type: string, version: number, rule: PostingRule<P>): void {
  const key = financialEventHandlerKey(type, version);
  if (RULES.has(key)) throw new Error(`[finance] posting rule ${key} is already registered`);
  RULES.set(key, rule as unknown as PostingRule<never>);
}

export function postingRuleKeys(): string[] {
  return [...RULES.keys()].sort();
}

/** Test support only: forget a rule registered by a test. */
export function unregisterPostingRuleForTests(type: string, version: number): void {
  if (process.env.NODE_ENV !== "test") throw new Error("unregisterPostingRuleForTests is test-only");
  RULES.delete(financialEventHandlerKey(type, version));
}

