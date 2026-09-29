import { describe, it, expect } from "vitest";
import crypto from "crypto";
import type { Request } from "express";
import { buildUserData, metaContextFromRequest, normalizeEmail, normalizePhone, normalizeText, sha256, splitName } from "./capi";

const hash = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

describe("Meta customer-information normalization", () => {
  it("lowercases and trims email", () => {
    expect(normalizeEmail("  Rahim.Uddin@Example.COM ")).toBe("rahim.uddin@example.com");
  });

  it("turns every way a BD mobile is typed into country-code digits", () => {
    for (const raw of ["01712345678", "+8801712345678", "8801712345678", "017-1234-5678", "1712345678"]) {
      expect(normalizePhone(raw)).toBe("8801712345678");
    }
    expect(normalizePhone("12345")).toBeNull();
  });

  it("strips punctuation/whitespace but keeps non-Latin letters", () => {
    expect(normalizeText("Cox's Bazar")).toBe("coxsbazar");
    expect(normalizeText("রহিম")).toBe("রহিম");
  });

  it("only derives a last name from a multi-word name", () => {
    expect(splitName("  Md  Rahim   Uddin ")).toEqual({ firstName: "Md", lastName: "Uddin" });
    expect(splitName("Rahim")).toEqual({ firstName: "Rahim", lastName: null });
  });
});

describe("buildUserData", () => {
  it("hashes identifiers, leaves browser signals unhashed, and drops what's missing", () => {
    const data = buildUserData(
      { email: "A@B.com", phone: "01712345678", fullName: "Rahim Uddin", city: "Dhaka", state: "Dhaka", externalId: "cust_1" },
      { clientIpAddress: "203.0.113.9", clientUserAgent: "UA", fbp: "fb.1.1700000000000.123", fbc: undefined },
    );
    expect(data.em).toEqual([hash("a@b.com")]);
    expect(data.ph).toEqual([hash("8801712345678")]);
    expect(data.fn).toEqual([hash("rahim")]);
    expect(data.ln).toEqual([hash("uddin")]);
    expect(data.country).toEqual([hash("bd")]);
    expect(data.external_id).toEqual([sha256("cust_1")]);
    expect(data.client_ip_address).toBe("203.0.113.9");
    expect(data.fbp).toBe("fb.1.1700000000000.123");
    expect("fbc" in data).toBe(false);
  });

  it("omits email entirely for a phone-only checkout", () => {
    const data = buildUserData({ email: null, phone: "01712345678", fullName: "Rahim", city: null, state: null, externalId: null }, {});
    expect("em" in data).toBe(false);
    expect("ln" in data).toBe(false);
    expect("external_id" in data).toBe(false);
  });
});

describe("metaContextFromRequest", () => {
  const req = (cookies: Record<string, string>) =>
    ({ cookies, ip: "203.0.113.9", get: (h: string) => (h === "user-agent" ? "Mozilla/5.0" : undefined) }) as unknown as Request;

  it("forwards well-formed Pixel cookies and rejects anything else", () => {
    expect(metaContextFromRequest(req({ _fbp: "fb.1.1700000000000.987654321", _fbc: "fb.1.1700000000000.IwAR0abc" }))).toEqual({
      clientIpAddress: "203.0.113.9",
      clientUserAgent: "Mozilla/5.0",
      fbp: "fb.1.1700000000000.987654321",
      fbc: "fb.1.1700000000000.IwAR0abc",
    });
    const ctx = metaContextFromRequest(req({ _fbp: "<script>", _fbc: "" }));
    expect(ctx.fbp).toBeUndefined();
    expect(ctx.fbc).toBeUndefined();
  });
});
