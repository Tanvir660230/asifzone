import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Premium UI programme (docs/superpowers/plans/2026-11-12-erp-premium-ui.md, Phase 7): the admin's look lives in the
// tokens, the globals.css recipes and the primitives. Three habits pull it apart again — a hand-picked font size
// (`text-[11px]`), shouting labels (`uppercase`) and a raw colour (`bg-[#f5f5f7]`). Hundreds of old uses remain and are
// cleared page by page, so this is a ratchet: each file may keep at most the count in the baseline below, a file not in
// the baseline may have none, and when a file improves the baseline must be lowered with it so it can't creep back.
//
// Lowered the baseline after cleaning files? Regenerate it: UPDATE_STYLE_BASELINE=1 pnpm --filter web test admin-style
// (never to raise a count — use a token, a recipe or a primitive instead).

const ROOT = join(import.meta.dirname, "..", "..");
const DIRS = ["app/admin", "components/admin"];
const BASELINE_FILE = join(import.meta.dirname, "admin-style-baseline.json");

const RULES = {
  fontSize: { re: /\btext-\[\d+(?:\.\d+)?(?:px|rem)\]/g, fix: "use the type scale (text-xs, text-sm, text-caption …)" },
  uppercase: { re: /\buppercase\b/g, fix: "labels are sentence case; drop `uppercase tracking-*`" },
  rawColour: { re: /-\[#[0-9a-fA-F]{3,8}\]/g, fix: "use a colour token (bg-surface, text-fg-muted …)" },
} as const;
type Rule = keyof typeof RULES;
type Counts = Partial<Record<Rule, number>>;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function scan(): Record<string, Counts> {
  const result: Record<string, Counts> = {};
  for (const dir of DIRS) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      const counts: Counts = {};
      for (const rule of Object.keys(RULES) as Rule[]) {
        const n = text.match(RULES[rule].re)?.length ?? 0;
        if (n) counts[rule] = n;
      }
      if (Object.keys(counts).length) result[relative(ROOT, file).replace(/\\/g, "/")] = counts;
    }
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

describe("admin style drift (ratchet)", () => {
  const current = scan();

  if (process.env.UPDATE_STYLE_BASELINE) {
    writeFileSync(BASELINE_FILE, `${JSON.stringify(current, null, 2)}\n`);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Record<string, Counts>;

  it("no admin file gains hand-picked font sizes, capitals or raw colours", () => {
    const grew: string[] = [];
    for (const [file, counts] of Object.entries(current)) {
      for (const rule of Object.keys(counts) as Rule[]) {
        const allowed = baseline[file]?.[rule] ?? 0;
        if ((counts[rule] ?? 0) > allowed) grew.push(`${file}: ${rule} ${counts[rule]} > ${allowed} — ${RULES[rule].fix}`);
      }
    }
    expect(grew).toEqual([]);
  });

  it("the baseline follows every improvement down", () => {
    const stale: string[] = [];
    for (const [file, counts] of Object.entries(baseline)) {
      for (const rule of Object.keys(counts) as Rule[]) {
        const now = current[file]?.[rule] ?? 0;
        if (now < (counts[rule] ?? 0)) stale.push(`${file}: ${rule} baseline ${counts[rule]}, now ${now}`);
      }
    }
    expect(stale, "lower the baseline: UPDATE_STYLE_BASELINE=1 pnpm --filter web test admin-style").toEqual([]);
  });
});
