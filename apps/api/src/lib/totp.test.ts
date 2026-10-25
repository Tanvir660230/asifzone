import { describe, it, expect } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUrl, totpAt, verifyTotp } from "./totp";

// RFC 6238 Appendix B (SHA-1, 8 digits) with the RFC's ASCII secret "12345678901234567890"; we use 6 digits, so the
// expected codes are the last six digits of the RFC's.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const RFC_VECTORS: Array<[number, string]> = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];

describe("totp", () => {
  it("matches the RFC 6238 test vectors", () => {
    for (const [seconds, code] of RFC_VECTORS) expect(totpAt(RFC_SECRET, seconds * 1000)).toBe(code);
  });

  it("base32 round-trips", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 255, 17, 99]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Decode("gezd gnbv")).toEqual(base32Decode("GEZDGNBV"));
  });

  it("a new secret is 160 bits of base32", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(s);
  });

  it("accepts the current code and one step either side, and says which step matched", () => {
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 90_000), now)).toBeNull();
  });

  it("ignores spaces in the typed code and refuses anything that isn't six digits", () => {
    const now = 1_800_000_000_000;
    const code = totpAt(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", now)).toBeNull();
  });

  it("an otpauth:// URL authenticator apps can scan", () => {
    const url = new URL(otpauthUrl({ issuer: "Asif Zone", account: "owner@example.com", secret: "JBSWY3DPEHPK3PXP" }));
    expect(url.protocol).toBe("otpauth:");
    expect(url.host).toBe("totp");
    expect(decodeURIComponent(url.pathname)).toBe("/Asif Zone:owner@example.com");
    expect(url.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(url.searchParams.get("issuer")).toBe("Asif Zone");
    expect(url.searchParams.get("digits")).toBe("6");
    expect(url.searchParams.get("period")).toBe("30");
  });
});
