// Lab vitals for key storefront pages on a production build: LCP, CLS, total blocking-ish long-task time, and bytes
// transferred (JS / all). Mobile profile (375×812, 4× CPU slowdown via CDP). Median of N runs per page.
//   node scripts/storefront-vitals.mjs <baseUrl> <outFile> [runs]
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [base, outFile, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 3);
const PAGES = [
  ["home", "/"],
  ["category", "/category/prayer-caps"],
  ["product", "/product/premium-pakistani-cap-white"],
  ["search", "/search?q=cap"],
  ["cart", "/cart"],
  ["checkout", "/checkout"],
];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const browser = await chromium.launch();
const results = {};
for (const [name, route] of PAGES) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("az_tracking_consent_v1", "denied");
      } catch {}
      window.__lcp = 0;
      window.__cls = 0;
      window.__longTasks = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__longTasks += Math.max(0, e.duration - 50);
      }).observe({ type: "longtask", buffered: true });
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    let js = 0;
    let all = 0;
    page.on("response", async (r) => {
      try {
        const len = Number(r.headers()["content-length"] ?? 0) || (await r.body()).length;
        all += len;
        if (r.request().resourceType() === "script") js += len;
      } catch {}
    });
    await page.goto(base + route, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => ({ lcp: window.__lcp, cls: window.__cls, tbt: window.__longTasks }));
    samples.push({ ...m, jsKB: js / 1024, allKB: all / 1024 });
    await ctx.close();
  }
  results[name] = {
    lcpMs: Math.round(median(samples.map((s) => s.lcp))),
    cls: Number(median(samples.map((s) => s.cls)).toFixed(3)),
    longTaskMs: Math.round(median(samples.map((s) => s.tbt))),
    jsKB: Math.round(median(samples.map((s) => s.jsKB))),
    allKB: Math.round(median(samples.map((s) => s.allKB))),
  };
  console.log(name, JSON.stringify(results[name]));
}
await browser.close();
fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
