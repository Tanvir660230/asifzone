import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionGet, sessionSet } from "./safe-storage";

afterEach(() => vi.unstubAllGlobals());

describe("session storage that never throws", () => {
  it("reads and writes when storage works", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
    sessionSet("k", "v");
    expect(sessionGet("k")).toBe("v");
  });

  it("keeps values in memory when the browser blocks storage (SecurityError: Access is denied)", () => {
    // Blocked site data / some in-app browsers: even touching window.sessionStorage throws.
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new DOMException("Access is denied for this document.", "SecurityError");
      },
    });
    expect(sessionGet("blocked-key")).toBeNull();
    expect(() => sessionSet("blocked-key", "01812345678")).not.toThrow();
    // Checkout → confirmation is an in-app navigation: the phone it remembered is still there.
    expect(sessionGet("blocked-key")).toBe("01812345678");
  });
});
