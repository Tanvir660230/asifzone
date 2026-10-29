import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { getSteadfastFraudCheck, getSteadfastStatusByConsignmentId } from "./steadfast";
import { CourierOutcomeUnknownError, CourierRateLimitedError } from "../errors";

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
  let restore: () => void = () => {};
  beforeEach(() => {
    restore = overrideIntegrationsForTests({ STEADFAST_API_KEY: "key", STEADFAST_SECRET_KEY: "secret", STEADFAST_BASE_URL: "https://steadfast.test/api/v1" });
  });
  afterEach(() => {
    restore();
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
  let restore: () => void = () => {};
  beforeEach(() => {
    restore = overrideIntegrationsForTests({ STEADFAST_API_KEY: "key", STEADFAST_SECRET_KEY: "secret", STEADFAST_BASE_URL: "https://steadfast.test/api/v1" });
    vi.useFakeTimers();
  });
  afterEach(() => {
    restore();
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

describe("getSteadfastStatusByConsignmentId (Order Operations Phase 0)", () => {
  let restore: () => void = () => {};
  beforeEach(() => {
    restore = overrideIntegrationsForTests({ STEADFAST_API_KEY: "key", STEADFAST_SECRET_KEY: "secret", STEADFAST_BASE_URL: "https://steadfast.test/api/v1" });
  });
  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it("reads delivery_status from the status API", async () => {
    mockFetch({ status: 200, delivery_status: "delivered_approval_pending" });
    await expect(getSteadfastStatusByConsignmentId("123")).resolves.toBe("delivered_approval_pending");
  });

  it("turns HTTP 429 into a rate-limit error carrying Retry-After, without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "Retry-After": "30" } }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await getSteadfastStatusByConsignmentId("123").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CourierRateLimitedError);
    expect((err as CourierRateLimitedError).retryAfterMs).toBe(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets a timeout surface as an ordinary failure (a status read is never an 'unknown booking')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
    const err = await getSteadfastStatusByConsignmentId("123").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CourierOutcomeUnknownError);
    expect(err).not.toBeInstanceOf(CourierRateLimitedError);
  });
});
