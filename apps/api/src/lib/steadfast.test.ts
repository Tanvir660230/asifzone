import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env";
import { getSteadfastFraudCheck } from "./steadfast";

// Real response bodies captured 2026-10-03 (phone redacted).
const SCORE_WITH_HISTORY = {
  status: 200,
  phone: "01700000000",
  score: null,
  level: null,
  reasons: [],
  scoring_disabled: true,
  doubtful_reports: false,
  total_reports: 0,
  delivery_ratio: 96,
  cancellation_ratio: 3,
  volume_band: "high",
  volume_range: "25+",
  fraud_categories: [],
  return_ratio: 3,
};

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getSteadfastFraudCheck", () => {
  const saved = { ...env.steadfast };
  beforeEach(() => {
    env.steadfast.apiKey = "key";
    env.steadfast.secretKey = "secret";
    env.steadfast.baseUrl = "https://steadfast.test/api/v1";
  });
  afterEach(() => {
    Object.assign(env.steadfast, saved);
    vi.unstubAllGlobals();
  });

  it("calls the score endpoint, not the retired count endpoint", async () => {
    const fetchMock = mockFetch(SCORE_WITH_HISTORY);
    await getSteadfastFraudCheck("01700000000");
    expect(fetchMock).toHaveBeenCalledWith("https://steadfast.test/api/v1/fraud_check/score/01700000000", expect.anything());
  });

  it("maps ratios and the volume range", async () => {
    mockFetch(SCORE_WITH_HISTORY);
    await expect(getSteadfastFraudCheck("01700000000")).resolves.toEqual({
      totalParcels: 25,
      volumeRange: "25+",
      successRate: 96,
      cancellationRate: 3,
      fraudReports: 0,
    });
  });

  it("reports no history when the volume range is empty", async () => {
    mockFetch({ ...SCORE_WITH_HISTORY, volume_range: "0", delivery_ratio: 0, cancellation_ratio: 0 });
    await expect(getSteadfastFraudCheck("01700000000")).resolves.toEqual({
      totalParcels: 0,
      volumeRange: null,
      successRate: null,
      cancellationRate: null,
      fraudReports: 0,
    });
  });

  it("rejects the retired endpoint's all-zero shape instead of caching it as 'no history'", async () => {
    mockFetch({ total_parcels: 0, total_delivered: 0, total_cancelled: 0, notice: "no longer returns parcel counts" });
    await expect(getSteadfastFraudCheck("01700000000")).rejects.toThrow(/Steadfast fraud check failed/);
  });
});

describe("getSteadfastFraudCheck rate limiting", () => {
  const saved = { ...env.steadfast };
  beforeEach(() => {
    env.steadfast.apiKey = "key";
    env.steadfast.secretKey = "secret";
    env.steadfast.baseUrl = "https://steadfast.test/api/v1";
    vi.useFakeTimers();
  });
  afterEach(() => {
    Object.assign(env.steadfast, saved);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits and retries after HTTP 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Too Many Attempts.", { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(SCORE_WITH_HISTORY), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = getSteadfastFraudCheck("01700000000");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ successRate: 96 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up with a clear message after repeated 429s", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = getSteadfastFraudCheck("01700000000");
    const assertion = expect(pending).rejects.toThrow(/try again in a minute/);
    await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
