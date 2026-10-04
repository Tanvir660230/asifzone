import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Phase 7 (docs/PHASE_7_AUDIT.md): one configuration concept → one owner → one resolution path. These focused scans keep a
// new hard-coded business currency/timezone, a second currency/timezone reader or a new settings-table owner out of CI.

const ROOT = join(__dirname, "..", "..", "..", "..", "..");
const API_SRC = join(ROOT, "apps", "api", "src");
const RUNTIME_DIRS = [API_SRC, join(ROOT, "packages", "shared", "src"), join(ROOT, "apps", "web", "app"), join(ROOT, "apps", "web", "components"), join(ROOT, "apps", "web", "lib")];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name === ".next" ? [] : files(full);
    return /\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full) && !/fixture/.test(full) ? [full] : [];
  });
}

/** Code only: comment lines (and trailing // comments) are dropped so documentation may name the old values. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|\/\*|\{\/\*)/.test(l))
    .map((l) => l.replace(/\s\/\/.*$/, ""))
    .join("\n");
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

/** Allowed, each for a stated reason. */
const LITERAL_ALLOWLIST: Record<string, string> = {
  // The single declared display locale (locale is not a configurable concept yet — PHASE_7_AUDIT §1).
  "packages/shared/src/format.ts": "DISPLAY_LOCALE",
  // Outage placeholder, mirrors the StoreSetting schema defaults; never a reader of store truth (PHASE_7_AUDIT D-11).
  "apps/web/lib/api/storefront.ts": "outage placeholder",
  // Transactional SMS copy in Bengali (locale content) — deferred to the content/locale work (PHASE_7_AUDIT §4).
  "packages/shared/src/sms-templates.ts": "locale content",
  "apps/api/src/lib/sms-templates.ts": "locale content",
};

describe("configuration SSOT — guard", () => {
  it("no hard-coded business currency, currency symbol, timezone or locale in runtime code", () => {
    const LITERALS: Array<[string, RegExp]> = [
      ['currency code "BDT"', /["'`]BDT["'`]/],
      ["currency symbol ৳", /৳/],
      ["timezone Asia/Dhaka", /Asia\/Dhaka/],
      ['locale "en-BD" outside DISPLAY_LOCALE', /["'`]en-BD["'`]/],
      ["fixed +6 h business offset", /6\s*\*\s*60\s*\*\s*60\s*\*\s*1000/],
    ];
    const offenders: string[] = [];
    for (const f of RUNTIME_DIRS.flatMap(files)) {
      if (LITERAL_ALLOWLIST[rel(f)]) continue;
      const text = code(f);
      for (const [name, re] of LITERALS) if (re.test(text)) offenders.push(`${rel(f)}: ${name}`);
    }
    expect(offenders).toEqual([]);
  });

  it("currency and timezone are read only through domain/config/commerce-settings", () => {
    const offenders = files(API_SRC)
      .filter((f) => rel(f) !== "apps/api/src/domain/config/commerce-settings.ts")
      .filter((f) => /getSettings\(\)\)?\.(currency|timezone)\b|settings\.(currency|timezone)\b|\|\|\s*["']BDT["']/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("each settings table has one owning module (no direct reads or writes elsewhere)", () => {
    const OWNERS: Array<[RegExp, string[]]> = [
      [/\b(prisma|tx|db)\.storeSetting\.(update|upsert|create|delete)/, ["apps/api/src/modules/settings/settings.service.ts"]],
      // Reads: the owner, plus the Phase 2 mirror drift check (pricingConfigDrift compares the mirrors, read-only).
      [/\b(prisma|tx|db)\.storeSetting\.find/, ["apps/api/src/modules/settings/settings.service.ts", "apps/api/src/domain/pricing/pricing-config.ts"]],
      [/\b(prisma|tx|db)\.taxSetting\.(update|upsert|create|delete)/, ["apps/api/src/domain/pricing/pricing-config.ts"]],
      [/\b(prisma|tx|db)\.shipping(Rate|Zone|ZoneMatch)\.(update|upsert|create|delete)/, ["apps/api/src/domain/pricing/pricing-config.ts"]],
    ];
    const offenders: string[] = [];
    for (const f of files(API_SRC)) {
      const text = code(f);
      for (const [re, owners] of OWNERS) if (re.test(text) && !owners.includes(rel(f))) offenders.push(`${rel(f)}: ${re}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the web shows business dates in the store timezone, never the browser's", () => {
    const WEB = RUNTIME_DIRS.slice(2);
    const offenders = WEB.flatMap(files)
      .filter((f) => /\.toLocaleDateString\(\)|\.toLocaleTimeString\(\[\]|timeZone:\s*["'](?!UTC["'])/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
