// Walks the "smart" storefront features and captures each: usual-size hint, delivery fees, WhatsApp order link, cart
// "Complete your order", checkout best-coupon auto-apply, homepage "Buy again", review photos, offline page.
//   node scripts/storefront-smart-shots.mjs <baseUrl> <outDir> <width> [customerTokenFile] [photoFile]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [base, out, widthArg, tokenFile, photoFile] = process.argv.slice(2);
const width = Number(widthArg);
const height = width < 600 ? 812 : 900;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const report = {};
const errors = [];

async function context(cookies = []) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("az_tracking_consent_v1", "denied");
    } catch {}
  });
  if (cookies.length) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/401|Content Security|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return { ctx, page };
}
// The site scrolls smoothly; jump instantly so a screenshot never lands mid-scroll.
const into = (locator, offset = 0) =>
  locator.evaluate((el, dy) => {
    el.scrollIntoView({ block: "center", behavior: "instant" });
    window.scrollBy({ top: dy, behavior: "instant" });
  }, offset);
const shot = (page, name) => page.screenshot({ path: path.join(out, `smart-${name}-${width}.png`) });
const PDP = "/product/premium-pakistani-cap-white";

// --- Guest: PDP → bag → cart → checkout ---
{
  const { ctx, page } = await context();
  await page.goto(base + PDP, { waitUntil: "networkidle" });
  report.hintBeforeAnyPurchase = await page.getByTestId("usual-size").count();
  const sizes = page.getByRole("group").first().getByRole("button");
  const pick = sizes.and(page.locator(":enabled")).nth(1);
  report.pickedSize = (await pick.textContent())?.trim();
  await pick.click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /^add to cart$/i }).first().click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");

  // Back on the page: the size they took is now "their usual".
  await page.goto(base + PDP, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  report.usualSizeHint = (await page.getByTestId("usual-size").textContent().catch(() => null))?.trim() ?? null;
  await into(page.getByTestId("usual-size"), 80);
  await page.waitForTimeout(300);
  await shot(page, "pdp-usual-size");
  report.deliveryFees = await page.getByTestId("delivery-fee").allTextContents();
  await into(page.getByTestId("delivery-estimate"), -60);
  await page.waitForTimeout(300);
  await shot(page, "pdp-delivery-whatsapp");

  // WhatsApp: pick a size first so the message names it, then read the link it opens.
  await page.getByTestId("usual-size").click();
  const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 5000 }).catch(() => null), page.getByTestId("whatsapp-order").click()]);
  const href = await page.getByTestId("whatsapp-order").getAttribute("href");
  report.whatsappText = href ? new URL(href).searchParams.get("text") : null;
  await popup?.close();

  await page.goto(base + "/cart", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const rail = page.getByTestId("complete-order");
  report.completeOrderShown = await rail.count();
  if (report.completeOrderShown) {
    await into(rail);
    await page.waitForTimeout(800);
    await shot(page, "cart-complete-order");
  }

  await page.goto(base + "/checkout", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  if (width < 600) await page.getByRole("button", { name: /order summary/i }).click();
  await page.waitForTimeout(400);
  const applied = page.getByTestId("applied-coupon");
  report.autoCoupon = (await applied.textContent().catch(() => null))?.trim() ?? null;
  await shot(page, "checkout-auto-coupon");
  if (report.autoCoupon) {
    await applied.getByRole("button", { name: "Remove" }).click();
    await page.waitForTimeout(1200);
    report.couponAfterRemove = await page.getByTestId("applied-coupon").count();
  }
  await ctx.close();
}

// --- Signed-in customer: homepage "Buy again", review photos ---
if (tokenFile) {
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  // A real sign-in also sets the double-submit CSRF cookie; any value works for that check.
  const { ctx, page } = await context([
    { name: "customer_access_token", value: token, domain: "localhost", path: "/" },
    { name: "csrf_token", value: "local-smart-shots", domain: "localhost", path: "/" },
  ]);
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const buyAgain = page.getByRole("heading", { name: "Buy again" });
  report.buyAgainShown = await buyAgain.count();
  if (report.buyAgainShown) {
    await into(buyAgain, 160);
    await page.waitForTimeout(800);
    await shot(page, "home-buy-again");
  }

  if (photoFile) {
    await page.goto(base + PDP + "#reviews", { waitUntil: "networkidle" });
    const write = page.getByRole("button", { name: /write a review/i });
    if (await write.count()) {
      await write.click();
      await page.getByTestId("review-photo-input").setInputFiles(photoFile);
      await page.waitForTimeout(2500);
      report.reviewPhotosAttached = await page.getByRole("button", { name: /remove photo/i }).count();
      await into(page.getByRole("button", { name: /remove photo/i }).first());
      await page.waitForTimeout(300);
      await shot(page, "review-form-photos");
    } else report.reviewPhotosAttached = "already reviewed";
  }
  await ctx.close();
}

// --- Offline page ---
{
  const { ctx, page } = await context();
  await page.goto(base + "/offline", { waitUntil: "networkidle" });
  await shot(page, "offline");
  await ctx.close();
}

console.log(JSON.stringify({ report, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
