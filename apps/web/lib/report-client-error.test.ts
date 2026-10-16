import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reportClientError, resetClientErrorReportsForTest, shouldReportClientError } from "./report-client-error";

const OWN_STACK = "TypeError: x\n    at ProductCard (https://asifzone.com/_next/static/chunks/app/page-abc.js:1:2000)";

describe("shouldReportClientError", () => {
  it("drops well-known browser noise", () => {
    expect(shouldReportClientError("ResizeObserver loop limit exceeded", OWN_STACK)).toBe(false);
    expect(shouldReportClientError("ResizeObserver loop completed with undelivered notifications.", OWN_STACK)).toBe(false);
    expect(shouldReportClientError("Script error.", undefined)).toBe(false);
  });

  it("drops errors thrown only by extensions or third-party scripts", () => {
    expect(shouldReportClientError("boom", "Error: boom\n    at x (chrome-extension://abc/content.js:1:1)")).toBe(false);
    expect(shouldReportClientError("boom", "Error: boom\n    at y (https://connect.facebook.net/en_US/fbevents.js:1:1)")).toBe(false);
  });

  it("keeps errors from the store's own code, and ones with no stack at all", () => {
    expect(shouldReportClientError("boom", OWN_STACK)).toBe(true);
    expect(shouldReportClientError("Loading chunk 12 failed", undefined)).toBe(true);
  });
});

describe("reportClientError", () => {
  const sendBeacon = vi.fn(() => true);

  beforeEach(() => {
    resetClientErrorReportsForTest();
    sendBeacon.mockClear();
    vi.stubGlobal("navigator", { sendBeacon });
    vi.stubGlobal("location", { pathname: "/products/black-panjabi", search: "?phone=01712345678" });
  });
  afterEach(() => vi.unstubAllGlobals());

  function sentBody(call = 0) {
    const blob = (sendBeacon.mock.calls[call] as unknown as [string, Blob])[1];
    return blob.text().then((t) => JSON.parse(t) as Record<string, unknown>);
  }

  it("sends the message, stack and path (without the query string)", async () => {
    const err = new TypeError("Cannot read properties of undefined");
    err.stack = OWN_STACK;
    reportClientError(err, "unhandled");
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect((sendBeacon.mock.calls[0] as unknown as [string])[0]).toMatch(/\/api\/v1\/client-errors$/);
    expect(await sentBody()).toMatchObject({ message: "TypeError: Cannot read properties of undefined", path: "/products/black-panjabi", kind: "unhandled" });
  });

  it("sends the same error once per page load", () => {
    const err = new Error("same");
    err.stack = OWN_STACK;
    reportClientError(err, "unhandled");
    reportClientError(err, "unhandled");
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("sends at most five reports per page load", () => {
    for (let i = 0; i < 8; i++) {
      const err = new Error(`distinct ${i}`);
      err.stack = OWN_STACK;
      reportClientError(err, "unhandled");
    }
    expect(sendBeacon).toHaveBeenCalledTimes(5);
  });

  it("trims long messages and stacks to what the API accepts", async () => {
    const err = new Error("m".repeat(900));
    err.stack = `Error\n${"    at f (https://asifzone.com/_next/static/chunks/a.js:1:1)\n".repeat(200)}`;
    reportClientError(err, "boundary");
    const body = await sentBody();
    expect((body.message as string).length).toBeLessThanOrEqual(500);
    expect((body.stack as string).length).toBeLessThanOrEqual(4000);
  });

  it("never throws, even for odd values", () => {
    expect(() => reportClientError(undefined, "unhandled")).not.toThrow();
    expect(() => reportClientError({ weird: true }, "unhandled")).not.toThrow();
  });
});
