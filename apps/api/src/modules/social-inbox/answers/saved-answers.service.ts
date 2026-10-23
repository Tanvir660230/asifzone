import { DHAKA_DELIVERY_DAYS, OUTSIDE_DHAKA_DELIVERY_DAYS } from "@clothing-brand/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { env } from "../../../config/env";
import { AppError } from "../../../lib/app-error";
import { getSettings } from "../../settings/settings.service";
import { MATCH_THRESHOLD, answerSimilarity, normalizeQuestion, questionSimilarity } from "./text-match";

/**
 * The answer library (Social Inbox, owner 2026-10-18): the Inbox learns the questions customers keep asking from the
 * replies that answer them, suggests a saved answer once the same reply was given a few times, and — after a person
 * approves it — answers that question without an AI call. Answers that change over time use live placeholders, so a
 * learned answer never goes stale.
 */

/** Replies needed (to the same question, saying the same thing) before an answer is suggested. */
export const LEARN_AFTER = 3;
/** Two replies "say the same thing" at or above this. */
const SAME_ANSWER = 0.5;
/** A draft sent with at least this much of its text unchanged counts as accepted. */
const ACCEPTED = 0.8;
/** Corrections that pause auto-send by themselves, once they are this share of uses. */
const PAUSE_AFTER_CORRECTIONS = 3;
const PAUSE_RATIO = 0.3;
/** Questions longer than this are specific (an order, a photo, a story) — not learned. */
const MAX_QUESTION_WORDS = 10;
const LOOKBACK_MS = 90 * 24 * 3_600_000;
const CACHE_MS = 60_000;

// ── Live placeholders ───────────────────────────────────────────────────────────────────────────

export const PLACEHOLDERS = ["delivery_charges", "delivery_time", "cod", "website", "store_name", "name"] as const;

export function unknownPlaceholders(answer: string): string[] {
  return [...answer.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p));
}

/** The answer with today's values: delivery fees from the shipping zones, the delivery estimate, COD, the website. */
export async function renderSavedAnswer(answer: string, ctx: { contactName: string | null }): Promise<string> {
  if (!/\{\w+\}/.test(answer)) return answer;
  const settings = await getSettings();
  const values: Record<string, () => Promise<string> | string> = {
    delivery_charges: async () => {
      const zones = await prisma.shippingZone.findMany({
        where: { isActive: true, rate: { isNot: null } },
        orderBy: [{ priority: "desc" }, { name: "asc" }],
        select: { name: true, rate: { select: { fee: true } } },
      });
      return zones.map((z) => `${z.name}: ${Number(z.rate!.fee)} taka`).join(", ");
    },
    delivery_time: () => `Dhakar bhetore ${DHAKA_DELIVERY_DAYS[0]}–${DHAKA_DELIVERY_DAYS[1]} din, Dhakar baire ${OUTSIDE_DHAKA_DELIVERY_DAYS[0]}–${OUTSIDE_DHAKA_DELIVERY_DAYS[1]} din`,
    cod: () => (settings.codEnabled ? "Cash on delivery ache" : "Cash on delivery nei, order er somoy payment korte hobe"),
    website: () => env.webOrigin.replace(/\/+$/, ""),
    store_name: () => settings.storeName,
    name: () => (ctx.contactName && !/customer|user/i.test(ctx.contactName) ? ctx.contactName.split(/\s+/)[0]! : ""),
  };
  let out = answer;
  for (const [key, value] of Object.entries(values)) {
    if (out.includes(`{${key}}`)) out = out.split(`{${key}}`).join(await value());
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

/** A learned reply, generalised: the store's own website address becomes {website}. */
function templatize(answer: string): string {
  const site = env.webOrigin.replace(/\/+$/, "");
  return site ? answer.split(site).join("{website}") : answer;
}

// ── Matching an incoming question ──────────────────────────────────────────────────────────────

type Library = Array<{ id: string; answer: string; autoSend: boolean; examples: string[][] }>;
let library: { at: number; entries: Library } | null = null;

export function invalidateAnswerLibrary() {
  library = null;
}

async function approvedLibrary(now: number): Promise<Library> {
  if (library && now - library.at < CACHE_MS) return library.entries;
  const rows = await prisma.savedAnswer.findMany({
    where: { status: "APPROVED" },
    select: { id: true, title: true, answer: true, autoSend: true, examples: { select: { normalized: true }, orderBy: { createdAt: "desc" }, take: 200 } },
  });
  const entries = rows.map((r) => ({
    id: r.id,
    answer: r.answer,
    autoSend: r.autoSend,
    examples: [normalizeQuestion(r.title), ...r.examples.map((e) => e.normalized.split(" ").filter(Boolean))].filter((x) => x.length > 0),
  }));
  library = { at: now, entries };
  return entries;
}

/** The approved answer to this question, if one matches well enough. */
export async function matchSavedAnswer(question: string, now = Date.now()): Promise<{ id: string; answer: string; autoSend: boolean; score: number } | null> {
  const words = normalizeQuestion(question);
  if (!words.length || words.length > MAX_QUESTION_WORDS) return null;
  let best: { id: string; answer: string; autoSend: boolean; score: number } | null = null;
  for (const entry of await approvedLibrary(now)) {
    for (const example of entry.examples) {
      const score = questionSimilarity(words, example);
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { id: entry.id, answer: entry.answer, autoSend: entry.autoSend, score };
    }
  }
  return best;
}

export async function recordHit(db: Prisma.TransactionClient | typeof prisma, savedAnswerId: string, now = new Date()) {
  await db.savedAnswer.updateMany({ where: { id: savedAnswerId }, data: { hits: { increment: 1 }, lastHitAt: now } });
}

/** Staff sent a reply where a saved answer's draft was waiting: unchanged = a use; rewritten = a correction, and enough
 * corrections pause its auto-send (a person looks at it again). Returns whether the draft was accepted. */
export async function recordDraftOutcome(tx: Prisma.TransactionClient, savedAnswerId: string, draftBody: string, sentBody: string, now = new Date()): Promise<boolean> {
  if (answerSimilarity(draftBody, sentBody) >= ACCEPTED) {
    await recordHit(tx, savedAnswerId, now);
    return true;
  }
  const a = await tx.savedAnswer.update({ where: { id: savedAnswerId }, data: { corrections: { increment: 1 } }, select: { corrections: true, hits: true, autoSend: true } });
  if (a.autoSend && a.corrections >= PAUSE_AFTER_CORRECTIONS && a.corrections >= (a.hits + a.corrections) * PAUSE_RATIO) {
    await tx.savedAnswer.update({ where: { id: savedAnswerId }, data: { autoSend: false, autoPausedAt: now } });
    invalidateAnswerLibrary();
  }
  return false;
}

// ── Learning from replies (outbox consumer `answer-learning`) ─────────────────────────────────

/**
 * Looks at one reply: if it was the first answer to a short customer question, the pair is kept; then it either joins
 * the saved answer for that question, or — when replies to the same question kept saying the same thing — a new
 * suggestion is made. Returns what happened (for the outbox log).
 */
export async function learnFromReply(messageId: string): Promise<"learned" | "suggested" | "skipped"> {
  const reply = await prisma.conversationMessage.findUnique({
    where: { id: messageId },
    select: { id: true, direction: true, author: true, body: true, createdAt: true, conversationId: true, template: true, savedAnswerId: true },
  });
  if (!reply || reply.direction !== "OUT" || (reply.author !== "STAFF" && reply.author !== "AI") || reply.template || reply.savedAnswerId) return "skipped";
  const previous = await prisma.conversationMessage.findMany({
    where: { conversationId: reply.conversationId, createdAt: { lte: reply.createdAt }, id: { not: reply.id } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { direction: true, body: true, createdAt: true },
  });
  const question = previous[0];
  // Only the first answer to a customer question teaches anything; a follow-up reply answers something else.
  if (!question || question.direction !== "IN" || reply.createdAt.getTime() - question.createdAt.getTime() > 48 * 3_600_000) return "skipped";
  const words = normalizeQuestion(question.body);
  if (!words.length || words.length > MAX_QUESTION_WORDS || /^\[[^\]]+\]/.test(question.body.trim())) return "skipped";

  const example = await prisma.answerExample.upsert({
    where: { messageId },
    create: { question: question.body.slice(0, 500), normalized: words.join(" "), answer: reply.body, source: reply.author, messageId },
    update: {},
  });
  if (example.savedAnswerId) return "learned";

  // Joins an existing answer (suggested or approved) for the same question.
  const answers = await prisma.savedAnswer.findMany({
    where: { status: { in: ["SUGGESTED", "APPROVED"] } },
    select: { id: true, title: true, examples: { select: { normalized: true }, take: 200, orderBy: { createdAt: "desc" } } },
  });
  for (const a of answers) {
    const known = [normalizeQuestion(a.title), ...a.examples.map((e) => e.normalized.split(" "))];
    if (known.some((k) => questionSimilarity(words, k) >= MATCH_THRESHOLD)) {
      await prisma.answerExample.update({ where: { id: example.id }, data: { savedAnswerId: a.id } });
      invalidateAnswerLibrary();
      return "learned";
    }
  }

  // Otherwise: enough unassigned replies to the same question that say the same thing → a suggestion.
  const pool = await prisma.answerExample.findMany({
    where: { savedAnswerId: null, createdAt: { gte: new Date(Date.now() - LOOKBACK_MS) } },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: { id: true, question: true, normalized: true, answer: true },
  });
  const group = pool.filter((e) => questionSimilarity(words, e.normalized.split(" ")) >= MATCH_THRESHOLD && answerSimilarity(reply.body, e.answer) >= SAME_ANSWER);
  if (group.length < LEARN_AFTER) return "learned";
  // The question most people asked (shortest wording on a tie) names it; the latest reply is the answer.
  const counts = new Map<string, number>();
  for (const e of group) counts.set(e.question.trim(), (counts.get(e.question.trim()) ?? 0) + 1);
  const title = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]![0];
  await prisma.$transaction(async (tx) => {
    const created = await tx.savedAnswer.create({ data: { title: title.slice(0, 200), answer: templatize(reply.body) }, select: { id: true } });
    await tx.answerExample.updateMany({ where: { id: { in: group.map((e) => e.id) }, savedAnswerId: null }, data: { savedAnswerId: created.id } });
  });
  return "suggested";
}

// ── Admin (Messages › Saved answers) ───────────────────────────────────────────────────────────

const VIEW_SELECT = {
  id: true,
  status: true,
  title: true,
  answer: true,
  autoSend: true,
  hits: true,
  corrections: true,
  lastHitAt: true,
  autoPausedAt: true,
  createdAt: true,
  _count: { select: { examples: true } },
  examples: { select: { question: true }, orderBy: { createdAt: "desc" as const }, take: 6 },
} satisfies Prisma.SavedAnswerSelect;

function toView(a: Prisma.SavedAnswerGetPayload<{ select: typeof VIEW_SELECT }>) {
  return {
    id: a.id,
    status: a.status,
    title: a.title,
    answer: a.answer,
    autoSend: a.autoSend,
    hits: a.hits,
    corrections: a.corrections,
    lastHitAt: a.lastHitAt?.toISOString() ?? null,
    autoPausedAt: a.autoPausedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    exampleCount: a._count.examples,
    examples: [...new Set(a.examples.map((e) => e.question.trim()))],
  };
}

export async function listSavedAnswers(now = new Date()) {
  const [rows, answeredWithoutAi] = await Promise.all([
    prisma.savedAnswer.findMany({ where: { status: { in: ["SUGGESTED", "APPROVED"] } }, orderBy: [{ status: "asc" }, { hits: "desc" }, { createdAt: "desc" }], select: VIEW_SELECT }),
    prisma.conversationMessage.count({ where: { savedAnswerId: { not: null }, createdAt: { gte: new Date(now.getTime() - 30 * 24 * 3_600_000) } } }),
  ]);
  const views = rows.map(toView);
  return { suggested: views.filter((v) => v.status === "SUGGESTED"), approved: views.filter((v) => v.status === "APPROVED"), answeredWithoutAi };
}

function assertPlaceholders(answer: string) {
  const unknown = unknownPlaceholders(answer);
  if (unknown.length) throw AppError.badRequest(`Unknown placeholder: {${unknown[0]}}. Use one of: ${PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}.`, { code: "UNKNOWN_PLACEHOLDER" });
}

export async function createSavedAnswer(input: { title: string; answer: string; examples: string[]; autoSend: boolean }, adminId: string) {
  assertPlaceholders(input.answer);
  const now = new Date();
  const created = await prisma.savedAnswer.create({
    data: {
      title: input.title,
      answer: input.answer,
      autoSend: input.autoSend,
      status: "APPROVED",
      approvedAt: now,
      approvedById: adminId,
      examples: {
        create: input.examples
          .map((q) => ({ q, words: normalizeQuestion(q) }))
          .filter((x) => x.words.length > 0)
          .map(({ q, words }, i) => ({ question: q, normalized: words.join(" "), answer: input.answer, source: "STAFF" as const, messageId: `manual:${now.getTime()}:${i}:${Math.random().toString(36).slice(2, 8)}` })),
      },
    },
    select: VIEW_SELECT,
  });
  invalidateAnswerLibrary();
  return toView(created);
}

export async function updateSavedAnswer(id: string, input: { status?: "APPROVED" | "DISMISSED"; title?: string; answer?: string; autoSend?: boolean }, adminId: string) {
  const current = await prisma.savedAnswer.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!current) throw AppError.notFound("Saved answer not found");
  if (input.answer !== undefined) assertPlaceholders(input.answer);
  const approving = input.status === "APPROVED" && current.status !== "APPROVED";
  const updated = await prisma.savedAnswer.update({
    where: { id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.answer !== undefined ? { answer: input.answer } : {}),
      // Turning auto-send back on (or a reviewed new wording) clears a pause the corrections caused.
      ...(input.autoSend !== undefined ? { autoSend: input.autoSend, ...(input.autoSend ? { autoPausedAt: null, corrections: 0 } : {}) } : {}),
      ...(input.answer !== undefined ? { autoPausedAt: null, corrections: 0 } : {}),
      ...(approving ? { approvedAt: new Date(), approvedById: adminId } : {}),
    },
    select: VIEW_SELECT,
  });
  invalidateAnswerLibrary();
  return toView(updated);
}

export async function deleteSavedAnswer(id: string) {
  const deleted = await prisma.savedAnswer.deleteMany({ where: { id } });
  if (!deleted.count) throw AppError.notFound("Saved answer not found");
  invalidateAnswerLibrary();
}
