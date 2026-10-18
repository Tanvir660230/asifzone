import { describe, expect, it } from "vitest";
import { comboOf } from "./keyboard";

const event = (key: string | undefined, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods }) as unknown as KeyboardEvent;

describe("comboOf", () => {
  it("names modifiers then the key, lower-cased", () => {
    expect(comboOf(event("K", { metaKey: true }))).toBe("mod+k");
    expect(comboOf(event("ArrowUp", { shiftKey: true }))).toBe("shift+arrowup");
    expect(comboOf(event(" "))).toBe("space");
  });

  it("does not throw on a keydown without a key — Chrome's autofill fires those", () => {
    expect(() => comboOf(event(undefined))).not.toThrow();
    expect(comboOf(event(undefined))).toBe("");
  });
});
