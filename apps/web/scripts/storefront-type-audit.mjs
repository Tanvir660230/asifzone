// Typography + mobile layout audit: per route and width, which font families actually render text (and where), fonts that
// failed to load, text under 12px, anything wider than the viewport, and text clipped without an ellipsis.
//   node scripts/storefront-type-audit.mjs <baseUrl> <outFile>
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [base = "http://localhost:3620", outFile = "type-audit.json"] = process.argv.slice(2);
const ROUTES = (process.env.ROUTES ?? "/,/category/prayer-caps,/category/men,/product/premium-pakistani-cap-white,/product/royal-amber,/search?q=cap,/search?q=zzzzqqq,/cart,/checkout,/wishlist,/track-order,/contact,/faq,/shipping-returns,/privacy-policy,/account/login,/account/register,/this-page-does-not-exist").split(",");
const WIDTHS = [375, 1280];

const browser = await chromium.launch();
const results = [];
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("az_tracking_consent_v1", "denied");
    } catch {}
  });
  const page = await ctx.newPage();
  for (const route of ROUTES) {
    await page.goto(base + route, { waitUntil: "networkidle" }).catch(() => {});
    await page.evaluate(async () => {
      // Load everything below the fold too.
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo({ top: y, behavior: "instant" });
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo({ top: 0, behavior: "instant" });
      await document.fonts.ready;
    });
    const data = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const describe = (el) => {
        const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 4).join(".") : "";
        return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""} "${(el.textContent || "").trim().slice(0, 40)}"`;
      };
      const visible = (el) => {
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.closest("[aria-hidden=true], .sr-only, [hidden]");
      };
      const families = {};
      const tiny = [];
      const clipped = [];
      const overflow = [];
      for (const el of document.querySelectorAll("body *")) {
        if (!visible(el)) continue;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && !el.closest(".ui-rail, [class*=overflow-x], [class*=snap-x]") && s.position !== "fixed") overflow.push(describe(el));
        const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!ownText) continue;
        const fam = s.fontFamily.split(",")[0].replace(/["']/g, "").trim();
        families[fam] ??= { count: 0, samples: [] };
        families[fam].count++;
        if (families[fam].samples.length < 4) families[fam].samples.push(describe(el));
        const size = parseFloat(s.fontSize);
        if (size < 12) tiny.push(`${size}px ${describe(el)}`);
        const clampedByDesign = s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none" || s.getPropertyValue("-webkit-line-clamp") !== "none";
        if (!clampedByDesign && s.overflow !== "visible" && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 4) && el.clientHeight > 0 && s.overflowY !== "auto" && s.overflowX !== "auto")
          clipped.push(describe(el));
      }
      const failedFonts = [...document.fonts].filter((f) => f.status === "error").map((f) => f.family);
      return { families, tiny: tiny.slice(0, 15), clipped: clipped.slice(0, 15), overflow: overflow.slice(0, 10), failedFonts, docWidth: document.documentElement.scrollWidth, vw };
    });
    results.push({ route, width, ...data });
    console.log(width, route, "families:", Object.keys(data.families).join(" | "), "tiny:", data.tiny.length, "clipped:", data.clipped.length, "overflow:", data.overflow.length, data.docWidth > data.vw ? "PAGE-SCROLLS-SIDEWAYS" : "");
  }
  await ctx.close();
}
fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
await browser.close();
