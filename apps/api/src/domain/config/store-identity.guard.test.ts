import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Phase 12 (docs/PHASE_12_IMPLEMENTATION_CONTRACT.md §21 guards 1, 9, 10): runtime code carries no store identity, and
// identity has exactly one owner — StoreSetting (Phase 7), extended in place rather than duplicated into a StoreProfile.
// Tests, e2e specs and docs may name stores freely; only runtime code is scanned.

const ROOT = join(__dirname, "..", "..", "..", "..", "..");
const RUNTIME_DIRS = [
  join(ROOT, "apps", "api", "src"),
  join(ROOT, "packages", "shared", "src"),
  join(ROOT, "packages", "ui-tokens", "src"),
  join(ROOT, "apps", "web", "app"),
  join(ROOT, "apps", "web", "components"),
  join(ROOT, "apps", "web", "lib"),
  join(ROOT, "apps", "web", "hooks"),
];
const SCHEMA = readFileSync(join(ROOT, "apps", "api", "prisma", "schema.prisma"), "utf8");

type Source = { path: string; text: string };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name === ".next" ? [] : files(full);
    return /\.(ts|tsx|js)$/.test(full) && !/\.test\.tsx?$/.test(full) && !/fixture/.test(full) ? [full] : [];
  });
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

/** Identity that must come from configuration, never from code (comments included: a store name in a comment is how
 * the next copy starts). */
const IDENTITY_LITERALS: Array<[string, RegExp]> = [
  ["store name", /asif[\s_-]?zone/i],
  ["production domain", /asifzone\.com/i],
  ["hard-coded store location", /Dhaka,\s*Bangladesh/],
];

export function identityOffenders(sources: Source[]): string[] {
  const out: string[] = [];
  for (const s of sources) for (const [name, re] of IDENTITY_LITERALS) if (re.test(s.text)) out.push(`${s.path}: ${name}`);
  return out;
}

/** Store-only identity fields (Address.addressLine is the customer's own address — a different concept — so only fields
 * no other model may legitimately carry are checked). */
const STORE_ONLY_FIELDS = ["legalName", "legalJurisdiction", "supportHours", "addressCountry", "addressPostalCode", "addressRegion", "addressCity"];

export function identityOwnerProblems(schema: string): string[] {
  const problems: string[] = [];
  const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1]!, body: m[2]! }));
  for (const m of models) {
    if (/^(Store(Profile|Identity|Info|Brand)|BusinessProfile|Brand(Settings|Profile))$/.test(m.name)) problems.push(`second identity owner: model ${m.name}`);
    if (m.name === "StoreSetting") continue;
    for (const f of STORE_ONLY_FIELDS) if (new RegExp(`^\\s+${f}\\s`, "m").test(m.body)) problems.push(`${m.name}.${f} duplicates StoreSetting identity`);
  }
  const store = models.find((m) => m.name === "StoreSetting")!;
  for (const f of ["legalName", "addressLine", ...STORE_ONLY_FIELDS]) if (!new RegExp(`^\\s+${f}\\s+String\\?`, "m").test(store.body)) problems.push(`StoreSetting.${f} missing or not optional`);
  // Commerce Settings boundaries (Phase 7) stay where they are — identity must not grow its own currency/timezone/tax.
  // ProductReadModel.currency is the Phase 3 read-model projection written from getCurrency(), not an owner.
  const PROJECTIONS: Record<string, string[]> = { currency: ["ProductReadModel"], timezone: [] };
  for (const f of ["currency", "timezone"]) {
    const holders = models.filter((m) => new RegExp(`^\\s+${f}\\s+String`, "m").test(m.body)).map((m) => m.name);
    if (holders.some((n) => n !== "StoreSetting" && !PROJECTIONS[f]!.includes(n))) problems.push(`${f} has an owner other than StoreSetting`);
  }
  return problems;
}

describe("store identity — guards", () => {
  it("no runtime code hard-codes a store's name, domain or location", () => {
    const sources = RUNTIME_DIRS.flatMap(files).map((f) => ({ path: rel(f), text: readFileSync(f, "utf8") }));
    expect(sources.length).toBeGreaterThan(100);
    expect(identityOffenders(sources)).toEqual([]);
  });

  it("identity has one owner: StoreSetting, extended in place (no StoreProfile; Commerce Settings boundaries unchanged)", () => {
    expect(identityOwnerProblems(SCHEMA)).toEqual([]);
  });

  it("identity fields are written only through the settings module", () => {
    const writes = RUNTIME_DIRS.slice(0, 1)
      .flatMap(files)
      .filter((f) => /storeSetting\.(update|upsert|create|updateMany)\(/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(writes).toEqual(["apps/api/src/modules/settings/settings.service.ts"]);
  });
});

describe("store identity — the guards catch planted violations (mutation check)", () => {
  it("identity literals", () => {
    expect(identityOffenders([{ path: "apps/web/components/x.tsx", text: "<title>Asif Zone</title>" }])).toHaveLength(1);
    expect(identityOffenders([{ path: "apps/web/lib/x.ts", text: 'const url = "https://asifzone.com";' }])).toHaveLength(2);
    expect(identityOffenders([{ path: "apps/web/components/x.tsx", text: "<li>Dhaka, Bangladesh</li>" }])).toHaveLength(1);
    expect(identityOffenders([{ path: "apps/web/components/x.tsx", text: "<li>{settings.storeName}</li>" }])).toHaveLength(0);
  });

  it("a second identity owner or a duplicated identity/commerce field", () => {
    const base = SCHEMA;
    expect(identityOwnerProblems(base + "\nmodel StoreProfile {\n  id String @id\n}\n")).toContain("second identity owner: model StoreProfile");
    expect(identityOwnerProblems(base + "\nmodel Extra {\n  id String @id\n  legalName String?\n}\n")).toContain("Extra.legalName duplicates StoreSetting identity");
    expect(identityOwnerProblems(base + "\nmodel Extra {\n  id String @id\n  currency String\n}\n")).toContain("currency has an owner other than StoreSetting");
    expect(identityOwnerProblems(base.replace(/^(\s+)legalName(\s+)String\?/m, "$1legalName$2String"))).toContain("StoreSetting.legalName missing or not optional");
  });
});
