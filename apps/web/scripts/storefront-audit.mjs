// Storefront audit: visits each public route at several widths and records screenshots, console errors, failed
// requests, horizontal overflow, heading outline, tiny text and unnamed controls. Run against a running dev/prod server:
//   node scripts/storefront-audit.mjs <baseUrl> <outDir> [label]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3620";
const out = process.argv[3] ?? "audit-out";
const label = process.argv[4] ?? "run";
const only = process.env.ROUTES ? process.env.ROUTES.split(",") : null;

const ROUTES = [
  ["home", "/"],
  ["category", "/category/prayer-caps"],
  ["category-parent", "/category/men"],
  ["category-empty", "/category/fragrance?minPrice=999999"],
  ["product", "/product/premium-pakistani-cap-white"],
  ["product-fragrance", "/product/royal-amber"],
  ["search", "/search?q=cap"],
  ["search-empty", "/search?q=zzzzqqq"],
  ["search-blank", "/search"],
  ["cart", "/cart"],
  ["checkout", "/checkout"],
  ["wishlist", "/wishlist"],
  ["track-order", "/track-order"],
  ["contact", "/contact"],
  ["faq", "/faq"],
  ["shipping-returns", "/shipping-returns"],
  ["privacy", "/privacy-policy"],
  ["terms", "/terms"],
  ["login", "/account/login"],
  ["register", "/account/register"],
  ["forgot", "/account/forgot-password"],
  ["account-redirect", "/account"],
  ["not-found", "/this-page-does-not-exist"],
  ["product-404", "/product/does-not-exist"],
  ["order-confirm-bad", "/order-confirmation/AZ-000000"],
];
const WIDTHS = [
  ["m", 375, 812],
  ["t", 768, 1024],
  ["d", 1440, 900],
];

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const report = [];
for (const [name, route] of ROUTES) {
  if (only && !only.includes(name)) continue;
  for (const [wName, width, height] of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    // Dismiss the tracking-consent banner so it does not cover every screenshot (it is audited separately).
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("az_tracking_consent_v1", "denied");
      } catch {}
    });
    const page = await ctx.newPage();
    const errors = [];
    const failed = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 300)));
    page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 160)}`));
    page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url().slice(0, 160)}`));
    let status = 0;
    const t0 = Date.now();
    try {
      const res = await page.goto(base + route, { waitUntil: "networkidle", timeout: 90000 });
      status = res?.status() ?? 0;
    } catch (e) {
      errors.push("goto: " + String(e).slice(0, 200));
    }
    await page.waitForTimeout(600);
    const ms = Date.now() - t0;
    const facts = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      const offenders = [];
      if (overflow > 0) {
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.right > doc.clientWidth + 1 && r.width > 0 && getComputedStyle(el).position !== "fixed") {
            offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
            if (offenders.length > 5) break;
          }
        }
      }
      const headings = [...document.querySelectorAll("h1,h2,h3")].map((h) => `${h.tagName}:${h.textContent.trim().slice(0, 40)}`);
      const tiny = new Set();
      for (const el of document.querySelectorAll("body *")) {
        if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || el.closest("[aria-hidden=true]")) continue;
        const fs = parseFloat(cs.fontSize);
        if (fs < 12 && el.getBoundingClientRect().width > 0) tiny.add(`${fs}px "${el.textContent.trim().slice(0, 30)}"`);
      }
      const unnamed = [];
      for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button]")) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const name = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.textContent.trim() || el.getAttribute("title") || el.getAttribute("placeholder") || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest("label") || el.querySelector("img[alt]:not([alt=''])");
        if (!name && el.type !== "hidden") unnamed.push(el.outerHTML.slice(0, 120));
      }
      const smallTargets = [];
      for (const el of document.querySelectorAll("button, a[href], input[type=checkbox], input[type=radio], [role=button]")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)) smallTargets.push(`${Math.round(r.width)}x${Math.round(r.height)} ${(el.getAttribute("aria-label") || el.textContent.trim()).slice(0, 30)}`);
      }
      const imgsNoAlt = [...document.querySelectorAll("img:not([alt])")].length;
      return {
        title: document.title,
        h1count: document.querySelectorAll("h1").length,
        headings: headings.slice(0, 25),
        overflow,
        offenders,
        tiny: [...tiny].slice(0, 12),
        tinyCount: tiny.size,
        unnamed: unnamed.slice(0, 8),
        smallTargets: smallTargets.slice(0, 12),
        smallTargetCount: smallTargets.length,
        imgsNoAlt,
        height: doc.scrollHeight,
        robots: document.querySelector('meta[name=robots]')?.content ?? null,
        canonical: document.querySelector('link[rel=canonical]')?.href ?? null,
        description: document.querySelector('meta[name=description]')?.content ?? null,
      };
    });
    const file = path.join(out, `${label}-${name}-${wName}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    report.push({ name, route, width, status, ms, errors: [...new Set(errors)].slice(0, 8), failed: [...new Set(failed)].slice(0, 8), ...facts });
    await ctx.close();
    process.stdout.write(`${name}@${width} ${status} ${ms}ms overflow=${facts.overflow} err=${errors.length}\n`);
  }
}
await browser.close();
fs.writeFileSync(path.join(out, `${label}-report.json`), JSON.stringify(report, null, 2));
