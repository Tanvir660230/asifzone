// Viewport-height slices of a page, for reviewing detail that a full-page screenshot compresses away.
//   node scripts/storefront-shots.mjs <baseUrl> <outDir> <name> <route> <width> [maxSlices] [height]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [base, out, name, route, widthArg, maxArg, heightArg] = process.argv.slice(2);
const width = Number(widthArg);
const height = Number(heightArg ?? (width < 600 ? 812 : 900));
const max = Number(maxArg ?? 6);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("az_tracking_consent_v1", "denied");
    const seed = window.__AUDIT_STORAGE__;
    if (seed) for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  } catch {}
});
if (process.env.AUDIT_STORAGE) {
  const entries = JSON.parse(fs.readFileSync(process.env.AUDIT_STORAGE, "utf8"));
  await ctx.addInitScript((e) => {
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
  }, entries);
}
const page = await ctx.newPage();
await page.goto(base + route, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(800);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
for (let i = 0; i < max && i * height < total; i++) {
  await page.evaluate((y) => window.scrollTo(0, y), i * height);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `${name}-${width}-${i}.png`) });
}
console.log(`${name}: ${Math.ceil(total / height)} slices of ${height}px (saved ${Math.min(max, Math.ceil(total / height))})`);
await browser.close();
