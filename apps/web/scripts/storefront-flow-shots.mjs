// Drives the real purchase path (PDP → size → add to cart → drawer → cart → checkout) and captures each step.
//   node scripts/storefront-flow-shots.mjs <baseUrl> <outDir> <width> [label]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [base, out, widthArg, label = "flow"] = process.argv.slice(2);
const width = Number(widthArg);
const height = width < 600 ? 812 : 900;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("az_tracking_consent_v1", "denied");
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !m.text().includes("401") && !m.text().includes("Content Security") && errors.push(m.text()));
const shot = async (name) => page.screenshot({ path: path.join(out, `${label}-${name}-${width}.png`) });

await page.goto(base + "/product/premium-pakistani-cap-white", { waitUntil: "networkidle" });
await page.getByRole("radio", { name: /M\/22/ }).first().click().catch(async () => {
  await page.getByRole("button", { name: /M\/22/ }).first().click();
});
await page.waitForTimeout(300);
await page.getByRole("button", { name: /^add to cart$/i }).first().click();
await page.waitForTimeout(1200);
await shot("drawer");
await page.goto(base + "/cart", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("cart");
await page.evaluate(() => window.scrollTo(0, 700));
await page.waitForTimeout(400);
await shot("cart-2");
await page.goto(base + "/checkout", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await shot("checkout");
await page.evaluate((h) => window.scrollTo(0, h), height);
await page.waitForTimeout(400);
await shot("checkout-2");
await page.evaluate((h) => window.scrollTo(0, h * 2), height);
await page.waitForTimeout(400);
await shot("checkout-3");
// Submit empty to see validation feedback (never completes an order: required fields are blank).
const submit = page.getByRole("button", { name: /place order|confirm order|order now/i }).first();
if (await submit.count()) {
  await submit.click();
  await page.waitForTimeout(800);
  await shot("checkout-invalid");
}
console.log(JSON.stringify({ errors: errors.slice(0, 10) }));
await browser.close();
