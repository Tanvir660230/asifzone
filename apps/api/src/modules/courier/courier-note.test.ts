import { describe, expect, it } from "vitest";
import { composeCourierNote, lineDiscountPercent, ruleIdsWithAncestors, type CourierNoteRuleLike } from "./courier-note";

const fragrance: CourierNoteRuleLike = { id: "r-frag", text: "পারফিউম — প্যাকেট খোলা যাবে না", trigger: "PRODUCT", minDiscountPercent: null, sortOrder: 0 };
const fragile: CourierNoteRuleLike = { id: "r-fragile", text: "ভাঙার জিনিস, সাবধানে রাখুন", trigger: "PRODUCT", minDiscountPercent: null, sortOrder: 1 };
const bigDiscount: CourierNoteRuleLike = { id: "r-disc", text: "ডিসকাউন্ট পণ্য — খুলে দেখানো যাবে না", trigger: "DISCOUNT", minDiscountPercent: 40, sortOrder: 2 };
const rules = [fragrance, fragile, bigDiscount];

const line = (ruleIds: string[], referenceUnitPrice = 1000, paidUnitPrice = 1000) => ({ ruleIds, referenceUnitPrice, paidUnitPrice });

describe("lineDiscountPercent", () => {
  it("is the share of the reference price the customer did not pay", () => {
    expect(lineDiscountPercent(1000, 600)).toBe(40);
    expect(lineDiscountPercent(1000, 1000)).toBe(0);
  });

  it("never goes negative and handles a zero reference", () => {
    expect(lineDiscountPercent(500, 700)).toBe(0);
    expect(lineDiscountPercent(0, 0)).toBe(0);
  });
});

describe("composeCourierNote", () => {
  it("returns null when no rule applies and there is no customer note", () => {
    expect(composeCourierNote({ rules, lines: [line([])], customerNote: null })).toBeNull();
  });

  it("adds the text of a rule ticked on a product", () => {
    expect(composeCourierNote({ rules, lines: [line(["r-frag"])], customerNote: null })).toBe("পারফিউম — প্যাকেট খোলা যাবে না");
  });

  it("lists each rule once, in the admin's order, however many lines carry it", () => {
    const note = composeCourierNote({ rules, lines: [line(["r-fragile"]), line(["r-frag", "r-fragile"]), line(["r-frag"])], customerNote: null });
    expect(note).toBe("পারফিউম — প্যাকেট খোলা যাবে না | ভাঙার জিনিস, সাবধানে রাখুন");
  });

  it("adds a discount rule when any line is discounted at least its threshold", () => {
    expect(composeCourierNote({ rules, lines: [line([], 1000, 600)], customerNote: null })).toBe("ডিসকাউন্ট পণ্য — খুলে দেখানো যাবে না");
    expect(composeCourierNote({ rules, lines: [line([], 1000, 601)], customerNote: null })).toBeNull();
  });

  it("ignores rule ids that no longer match an active rule", () => {
    expect(composeCourierNote({ rules, lines: [line(["deleted-rule"])], customerNote: null })).toBeNull();
  });

  it("does not fire a discount rule just because it was ticked on a product", () => {
    expect(composeCourierNote({ rules, lines: [line(["r-disc"])], customerNote: null })).toBeNull();
  });

  it("appends the customer's own note after the store's rules", () => {
    expect(composeCourierNote({ rules, lines: [line(["r-frag"])], customerNote: "  অফিস টাইমে দেবেন " })).toBe(
      "পারফিউম — প্যাকেট খোলা যাবে না | গ্রাহকের নোট: অফিস টাইমে দেবেন",
    );
    expect(composeCourierNote({ rules, lines: [line([])], customerNote: "অফিস টাইমে দেবেন" })).toBe("গ্রাহকের নোট: অফিস টাইমে দেবেন");
  });
});

describe("ruleIdsWithAncestors", () => {
  it("collects rules from the category and every parent above it", () => {
    const categories = new Map([
      ["perfume", { parentId: null, courierNoteRuleIds: ["r-frag"] }],
      ["attar", { parentId: "perfume", courierNoteRuleIds: ["r-fragile"] }],
    ]);
    expect(ruleIdsWithAncestors("attar", categories).sort()).toEqual(["r-frag", "r-fragile"]);
    expect(ruleIdsWithAncestors("missing", categories)).toEqual([]);
  });

  it("survives a parent cycle", () => {
    const categories = new Map([
      ["a", { parentId: "b", courierNoteRuleIds: ["r1"] }],
      ["b", { parentId: "a", courierNoteRuleIds: ["r2"] }],
    ]);
    expect(ruleIdsWithAncestors("a", categories).sort()).toEqual(["r1", "r2"]);
  });
});
