import { describe, expect, it } from "vitest";
import { isChunkLoadError, shouldReloadForChunkError } from "./chunk-error";

describe("isChunkLoadError", () => {
  it("recognises webpack's failed chunk downloads", () => {
    expect(isChunkLoadError(Object.assign(new Error("Loading chunk 9 failed.\n(missing: https://x/_next/static/chunks/9-abc.js)"), { name: "ChunkLoadError" }))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 3651 failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Loading CSS chunk 12 failed"))).toBe(true);
  });

  it("leaves every other error alone", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("shouldReloadForChunkError", () => {
  it("reloads once, then not again within a minute — a chunk that is really gone must not loop", () => {
    const now = 1_000_000;
    expect(shouldReloadForChunkError(null, now)).toBe(true);
    expect(shouldReloadForChunkError(String(now - 5_000), now)).toBe(false);
    expect(shouldReloadForChunkError(String(now - 120_000), now)).toBe(true);
  });
});
