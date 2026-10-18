import { describe, it, expect } from "vitest";
import { MATCH_THRESHOLD, normalizeQuestion, questionSimilarity, answerSimilarity } from "./text-match";

const same = (a: string, b: string) => expect(questionSimilarity(a, b), `${a} ~ ${b}`).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
const different = (a: string, b: string) => expect(questionSimilarity(a, b), `${a} !~ ${b}`).toBeLessThan(MATCH_THRESHOLD);

describe("normalizeQuestion", () => {
  it("folds Banglish spellings, Bangla script, greetings and politeness into the same words", () => {
    expect(normalizeQuestion("Assalamu alaikum bhai, DAAAM koto??")).toEqual(normalizeQuestion("price koto"));
    expect(normalizeQuestion("দাম কত?")).toEqual(normalizeQuestion("dam koto"));
    expect(normalizeQuestion("Delivary charge koto apu plz")).toEqual(normalizeQuestion("ডেলিভারি চার্জ কত"));
  });

  it("keeps the words that carry the question", () => {
    expect(normalizeQuestion("Cash on delivery ache?")).toContain("cod");
    expect(normalizeQuestion("কিভাবে অর্ডার করবো")).toEqual(expect.arrayContaining(["how", "order"]));
  });
});

describe("questionSimilarity", () => {
  it("the same question, typed differently, matches", () => {
    same("delivery charge koto?", "Delivary charj koto vai");
    same("delivery charge koto?", "ডেলিভারি চার্জ কত?");
    same("kivabe order korbo", "order kibhabe korte hobe");
    same("cash on delivery ache?", "COD hobe?");
    same("Chittagong e delivery koto din lage", "ctg te koto din lagbe delivery");
    same("apnader shop kothay", "dokan ta kothay");
  });

  it("different questions don't", () => {
    different("delivery charge koto?", "delivery koto din lage");
    different("kivabe order korbo", "order cancel korbo kivabe");
    different("cash on delivery ache?", "bkash e payment kora jabe?");
    different("size chart ache?", "delivery charge koto?");
  });

  it("an empty or emoji-only message matches nothing", () => {
    expect(questionSimilarity("👍", "👍")).toBe(0);
    expect(questionSimilarity("", "dam koto")).toBe(0);
  });
});

describe("answerSimilarity", () => {
  it("near-identical replies are close, different replies are not", () => {
    expect(answerSimilarity("Dhakay 60 taka, baire 120 taka", "Dhakar moddhe 60 taka ar baire 120 taka")).toBeGreaterThanOrEqual(0.5);
    expect(answerSimilarity("Dhakay 60 taka, baire 120 taka", "Ji L size ache, dam 1450")).toBeLessThan(0.5);
  });
});
