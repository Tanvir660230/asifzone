import { describe, expect, it } from "vitest";
import { describeDevice } from "./device-label";

describe("describeDevice", () => {
  it("names common browsers and systems", () => {
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toEqual({ label: "Chrome on Windows", phone: false });
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toEqual({ label: "Safari on iPhone", phone: true });
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toEqual({ label: "Chrome on Android", phone: true });
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toEqual({ label: "Edge on Windows", phone: false });
  });

  it("falls back when there's nothing to go on", () => {
    expect(describeDevice(null)).toEqual({ label: "Unknown device", phone: false });
    expect(describeDevice("curl/8.0")).toEqual({ label: "Unknown device", phone: false });
  });
});
