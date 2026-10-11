// Sold-out states and a mobile sweep: category cards (sold out / sizes left), a sold-out size picked on the product page,
// and full-page captures of the main routes.
//   node scripts/storefront-stock-shots.mjs <baseUrl> <outDir> <width>
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [base, out, widthArg] = process.argv.slice(2);
const width = Number(widthArg);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 900 }, reducedMotion: "reduce" });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("az_tracking_consent_v1", "denied");
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const report = {};
const center = (locator) => locator.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));

await page.goto(base + "/category/prayer-caps", { waitUntil: "networkidle" });
report.soldOutCards = await page.getByTestId("card-sold-out").count();
report.sizesLeftNotes = await page.getByText(/ of \d+ sizes left$/).count();
const firstSoldOut = page.getByTestId("card-sold-out").first();
if (report.soldOutCards) {
  await center(firstSoldOut);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `stock-category-${width}.png`) });
}

await page.goto(base + "/product/premium-pakistani-cap-white", { waitUntil: "networkidle" });
const soldOutPill = page.getByRole("group").first().getByRole("button", { name: /out of stock/ }).first();
report.soldOutPillEnabled = await soldOutPill.isEnabled();
await soldOutPill.click();
await page.waitForTimeout(400);
report.addButtonText = (await page.getByRole("button", { name: /^(sold out|add to cart)$/i }).first().textContent())?.trim();
report.alertButton = await page.getByTestId("stock-alert").count();
report.legend = (await page.getByTestId("sold-out-legend").textContent().catch(() => null))?.trim() ?? null;
await center(soldOutPill);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, `stock-pdp-soldout-size-${width}.png`) });

for (const [name, route] of [
  ["home", "/"],
  ["category", "/category/prayer-caps"],
  ["product", "/product/royal-amber"],
  ["search", "/search?q=cap"],
  ["track", "/track-order"],
  ["login", "/account/login"],
  ["contact", "/contact"],
  ["faq", "/faq"],
]) {
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `sweep-${name}-${width}.png`), fullPage: true });
}

console.log(JSON.stringify({ report, errors }, null, 1));
await browser.close();
