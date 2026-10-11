// Blueprint V2 P9 performance budget: each Store Console page ships at most 250 KB (gzip) of its own JavaScript.
// "Its own" = the chunks of the page entry minus what every admin page already shares (the framework/main chunks and the
// root, admin and shell layouts). Run after `next build`: `node scripts/check-admin-budget.mjs [--all]`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 250;
const NEXT = join(import.meta.dirname, "..", ".next");
const manifestPath = join(NEXT, "app-build-manifest.json");
if (!existsSync(join(NEXT, "BUILD_ID")) || !existsSync(manifestPath)) {
  console.error("No production build found — run `next build` first.");
  process.exit(2);
}

const { pages } = JSON.parse(readFileSync(manifestPath, "utf8"));
const { rootMainFiles = [], polyfillFiles = [] } = JSON.parse(readFileSync(join(NEXT, "build-manifest.json"), "utf8"));

const sizes = new Map();
const gz = (file) => {
  if (!sizes.has(file)) sizes.set(file, gzipSync(readFileSync(join(NEXT, file))).length);
  return sizes.get(file);
};
const js = (files) => (files ?? []).filter((f) => f.endsWith(".js"));

// Layout entries that wrap a page: "/admin/(shell)/orders/page" → "/layout", "/admin/layout", "/admin/(shell)/layout", …
const layoutsFor = (entry) => {
  const parts = entry.split("/").slice(1, -1);
  return ["/layout", ...parts.map((_, i) => `/${parts.slice(0, i + 1).join("/")}/layout`)].filter((l) => pages[l]);
};

const shared = new Set([...rootMainFiles, ...polyfillFiles]);
const rows = Object.keys(pages)
  .filter((entry) => entry.startsWith("/admin/") && entry.endsWith("/page"))
  .map((entry) => {
    const wrapped = new Set([...shared, ...layoutsFor(entry).flatMap((l) => pages[l])]);
    const own = js(pages[entry]).filter((f) => !wrapped.has(f));
    const kb = own.reduce((sum, f) => sum + gz(f), 0) / 1024;
    return { route: entry.replace(/\/\([^)]+\)/g, "").replace(/\/page$/, "") || "/", kb };
  })
  .sort((a, b) => b.kb - a.kb);

const sharedKb = [...new Set([...shared, ...js(pages["/admin/(shell)/layout"]), ...js(pages["/admin/layout"]), ...js(pages["/layout"])])]
  .filter((f) => f.endsWith(".js"))
  .reduce((sum, f) => sum + gz(f), 0) / 1024;

const over = rows.filter((r) => r.kb > BUDGET_KB);
const show = process.argv.includes("--all") ? rows : rows.slice(0, 15);
console.log(`Shared by every admin page (framework + layouts): ${sharedKb.toFixed(1)} KB gzip\n`);
console.log(`Page-own JS, gzip (budget ${BUDGET_KB} KB) — ${rows.length} pages${show.length < rows.length ? `, largest ${show.length}` : ""}:`);
for (const r of show) console.log(`${r.kb > BUDGET_KB ? "✗" : " "} ${r.kb.toFixed(1).padStart(7)} KB  ${r.route}`);
if (over.length) {
  console.error(`\n${over.length} page(s) over the ${BUDGET_KB} KB budget.`);
  process.exit(1);
}
console.log(`\nAll ${rows.length} admin pages within budget.`);
