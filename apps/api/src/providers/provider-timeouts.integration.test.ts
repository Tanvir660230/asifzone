import { EventEmitter } from "node:events";
import https from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../lib/app-error";
import { initSslcommerzSession, SSLCOMMERZ_TIMEOUT_MS, validateSslcommerzTransaction } from "./payment/sslcommerz";
import { EPS_TIMEOUT_MS, verifyEpsTransaction } from "./payment/eps";

// Phase 12 W6 (contract P-1, P-2; push P-3 is push-timeout.test.ts): the provider calls that had no bound now have one, and a timeout surfaces exactly like
// the transport failure each caller already handles. No real network: fetch / https.request / web-push are stubbed.

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const params = { orderNumber: "P12-T", amount: 100, customerName: "T", customerEmail: null, customerPhone: "01700000000", customerAddress: "A" };

describe("SSLCommerz — bounded by SSLCOMMERZ_TIMEOUT_MS", () => {
  it("init and validation each pass a 20 s AbortSignal to fetch", async () => {
    expect(SSLCOMMERZ_TIMEOUT_MS).toBe(20_000);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const signals: Array<AbortSignal | undefined> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return new Response(JSON.stringify({ status: "SUCCESS", GatewayPageURL: "https://ssl.example/pay", sessionkey: "SK" }));
    }));
    await initSslcommerzSession(params);
    await validateSslcommerzTransaction("VAL");
    expect(signals).toHaveLength(2);
    for (const s of signals) expect(s).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy.mock.calls.filter(([ms]) => ms === SSLCOMMERZ_TIMEOUT_MS)).toHaveLength(2);
  });

  it("a timed-out init becomes the existing friendly 400; a timed-out validation becomes 'not verified' (null)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }));
    const err = await initSslcommerzSession(params).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(400);
    expect((err as AppError).message).toMatch(/Could not start the payment session/);
    expect(await validateSslcommerzTransaction("VAL")).toBeNull();
  });
});

describe("EPS — each attempt bounded by EPS_TIMEOUT_MS, attempt loop unchanged", () => {
  it("a hanging EPS request is destroyed after 20 s, retried by the existing loop (3 attempts), then fails like any transport error", async () => {
    expect(EPS_TIMEOUT_MS).toBe(20_000);
    vi.useFakeTimers();
    const destroyed: string[] = [];
    const requestSpy = vi.spyOn(https, "request").mockImplementation((() => {
      const req = new EventEmitter() as EventEmitter & { write: () => void; end: () => void; destroy: (e: Error) => void };
      req.write = () => undefined;
      req.end = () => undefined; // never responds
      req.destroy = (e: Error) => {
        destroyed.push(e.message);
        req.emit("error", e);
      };
      return req;
    }) as unknown as typeof https.request);

    const outcome = verifyEpsTransaction("M-1").then(() => "resolved", (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3 * EPS_TIMEOUT_MS + 2_000);
    const err = await outcome;

    expect(requestSpy).toHaveBeenCalledTimes(3); // the token request: 3 attempts, as before
    expect(destroyed).toEqual(Array(3).fill(`EPS request timed out after ${EPS_TIMEOUT_MS} ms`));
    expect(err).toBeInstanceOf(AppError); // getEpsToken's existing friendly failure
    expect((err as AppError).statusCode).toBe(400);
  });

  it("a request that answers in time is not destroyed", async () => {
    vi.useFakeTimers();
    let destroyCalls = 0;
    vi.spyOn(https, "request").mockImplementation(((_opts: unknown, onResponse: (res: EventEmitter) => void) => {
      const req = new EventEmitter() as EventEmitter & { write: () => void; end: () => void; destroy: () => void };
      req.write = () => undefined;
      req.destroy = () => void destroyCalls++;
      req.end = () => {
        const res = new EventEmitter();
        onResponse(res);
        res.emit("data", Buffer.from(JSON.stringify({ token: "tok", expireDate: new Date(Date.now() + 3_600_000).toISOString() })));
        res.emit("end");
      };
      return req;
    }) as unknown as typeof https.request);
    // token OK, verify answers with an EPS error body → null (unchanged semantics), and no destroy
    await verifyEpsTransaction("M-2");
    await vi.advanceTimersByTimeAsync(EPS_TIMEOUT_MS * 2);
    expect(destroyCalls).toBe(0);
  });
});
