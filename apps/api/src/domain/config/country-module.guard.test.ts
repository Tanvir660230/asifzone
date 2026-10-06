import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  BD_COUNTRY_CODE,
  BD_COUNTRY_NAME,
  BD_DEFAULT_GATEWAY_CITY,
  BD_DIVISIONS,
  DHAKA_DELIVERY_DAYS,
  estimateDelivery,
  isBdMobileLocal,
  isInsideDhaka,
  normalizeBdPhone,
  OUTSIDE_DHAKA_DELIVERY_DAYS,
  PHONE_REGEX,
  toBdInternationalDigits,
} from "@clothing-brand/shared";

// Phase 12 W1 (docs/PHASE_12_IMPLEMENTATION_CONTRACT.md §10, §21 guard 4): every Bangladesh-specific rule and reference
// dataset has ONE owner, packages/shared/src/country/bd.ts. These scans keep a second copy of a rule (a phone regex, a
// "880" conversion, the Dhaka split, the division list, a hard-coded country code/name) out of runtime code. Copy text
// that merely *mentions* Bangladesh (footer prose, terms, search synonyms) is presentation and is not scanned.

const ROOT = join(__dirname, "..", "..", "..", "..", "..");
const RUNTIME_DIRS = [
  join(ROOT, "apps", "api", "src"),
  join(ROOT, "packages", "shared", "src"),
  join(ROOT, "apps", "web", "app"),
  join(ROOT, "apps", "web", "components"),
  join(ROOT, "apps", "web", "lib"),
  join(ROOT, "apps", "web", "hooks"),
];
const OWNER = "packages/shared/src/country/bd.ts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name === ".next" ? [] : files(full);
    return /\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full) && !/fixture/.test(full) ? [full] : [];
  });
}

/** Code only: comment lines (and trailing // comments) are dropped so documentation may describe the rules. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|\/\*|\{\/\*)/.test(l))
    .map((l) => l.replace(/\s\/\/.*$/, ""))
    .join("\n");
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

/** Rule signatures that may appear only in the owner. */
export const BD_RULE_SIGNATURES: Array<[string, RegExp]> = [
  ["BD mobile regex", /01\[3-9\]\\d|\^01\\d\{9\}/],
  ['"880" international conversion', /`880\$\{|`88\$\{|startsWith\(\s*["']880["']\s*\)|["'`]880["'`]/],
  ["Dhaka district/division comparison", /[=!]==\s*["']Dhaka["']|["']Dhaka["']\s*[=!]==/],
  ["division list literal", /["']Chattogram["']\s*,\s*["']Rajshahi["']/],
  ['country code literal "BD"', /["'`]BD["'`]/],
  ['country name literal "Bangladesh" (as a value)', /[:=(,]\s*["'`]Bangladesh["'`]/],
  ["phone validation message", /Enter a valid Bangladeshi phone number/],
];

export function bdRuleOffenders(sources: Array<{ path: string; text: string }>): string[] {
  const out: string[] = [];
  for (const { path, text } of sources) {
    if (path === OWNER) continue;
    for (const [name, re] of BD_RULE_SIGNATURES) if (re.test(text)) out.push(`${path}: ${name}`);
  }
  return out;
}

describe("country module (Bangladesh) — guard", () => {
  it("Bangladesh rules and reference data live only in packages/shared/src/country/bd.ts", () => {
    const sources = RUNTIME_DIRS.flatMap(files).map((f) => ({ path: rel(f), text: code(f) }));
    expect(sources.some((s) => s.path === OWNER)).toBe(true);
    expect(bdRuleOffenders(sources)).toEqual([]);
  });

  it("the guard itself catches a re-introduced copy of each rule (mutation check)", () => {
    const mutants = [
      "const r = /^01[3-9]\\d{8}$/;",
      "return `880${local.slice(1)}`;",
      'if (district === "Dhaka") fee = 60;',
      'const d = ["Dhaka", "Chattogram", "Rajshahi"];',
      'applicableCountry: "BD",',
      'cus_country: "Bangladesh",',
      'z.string().regex(r, "Enter a valid Bangladeshi phone number")',
    ];
    for (const m of mutants) expect(bdRuleOffenders([{ path: "apps/api/src/x.ts", text: m }])).not.toEqual([]);
    // …and leaves presentation prose alone.
    expect(bdRuleOffenders([{ path: "apps/web/x.tsx", text: "<p>We deliver across Bangladesh.</p>" }])).toEqual([]);
  });
});

describe("country module (Bangladesh) — behaviour is unchanged by the move", () => {
  it("phones: same normalisation, validation and international form as before Phase 12", () => {
    for (const input of ["01712345678", "+8801712345678", "8801712345678", "008801712345678", "1712345678", "017-1234 5678"]) {
      expect(normalizeBdPhone(input)).toBe("01712345678");
      expect(toBdInternationalDigits(input)).toBe("8801712345678");
    }
    expect(PHONE_REGEX.test("01712345678")).toBe(true);
    expect(PHONE_REGEX.test("01212345678")).toBe(false); // 012 is not a mobile prefix
    expect(isBdMobileLocal("01212345678")).toBe(true); // Meta's looser pre-Phase-12 shape, kept
    expect(isBdMobileLocal("0171234567")).toBe(false);
  });

  it("Dhaka split and delivery estimate: Dhaka district only, 1–2 vs 3–5 days", () => {
    expect(isInsideDhaka("Dhaka")).toBe(true);
    expect(isInsideDhaka("Gazipur")).toBe(false); // Dhaka division, outside-Dhaka rate
    expect(isInsideDhaka(null)).toBe(false);
    expect(DHAKA_DELIVERY_DAYS).toEqual([1, 2]);
    expect(OUTSIDE_DHAKA_DELIVERY_DAYS).toEqual([3, 5]);
    const from = new Date("2026-10-01T00:00:00Z");
    expect(estimateDelivery("Dhaka", from)).toMatchObject({ minDays: 1, maxDays: 2 });
    expect(estimateDelivery("Sylhet", from)).toMatchObject({ minDays: 3, maxDays: 5 });
  });

  it("constants keep the exact values the gateways and structured data used", () => {
    expect(BD_COUNTRY_CODE).toBe("BD");
    expect(BD_COUNTRY_NAME).toBe("Bangladesh");
    expect(BD_DEFAULT_GATEWAY_CITY).toBe("Dhaka");
    expect(BD_DIVISIONS).toEqual(["Dhaka", "Chattogram", "Rajshahi", "Khulna", "Barishal", "Sylhet", "Rangpur", "Mymensingh"]);
  });
});
