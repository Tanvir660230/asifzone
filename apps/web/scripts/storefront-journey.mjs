// The storefront journey after the UX fixes (docs/STOREFRONT_UX_FIX_PLAN.md): contact menu opens on every page, header
// stays in view, homepage sections show two rows, add one product then two more without losing the page, the bag, and a
// focused checkout. Prints a JSON report and saves screenshots.
//   node scripts/storefront-journey.mjs <baseUrl> <outDir> <width>
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [base, out, widthArg] = process.argv.slice(2);
const width = Number(widthArg);
const phone = width < 600;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: phone ? 812 : 900 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("az_tracking_consent_v1", "denied");
  } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const r = {};
const shot = (name) => page.screenshot({ path: path.join(out, `journey-${name}-${width}.png`) });
const center = (loc) => loc.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));

// 1. Contact menu opens (and stays open) on every page, scrolled or not.
r.contactMenu = {};
for (const [name, route, y] of [["home", "/", 0], ["home-scrolled", "/", 1400], ["category", "/category/prayer-caps", 600], ["product", "/product/premium-pakistani-cap-white", 0], ["cart", "/cart", 0]]) {
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
  await page.waitForTimeout(400);
  const fab = page.getByRole("button", { name: "Contact us" });
  await fab.click();
  await page.waitForTimeout(700);
  const open = await page.getByRole("button", { name: "Close contact menu" }).getAttribute("aria-expanded").catch(() => null);
  const feedbackVisible = await page.getByRole("button", { name: "Send feedback" }).isVisible().catch(() => false);
  r.contactMenu[name] = open === "true" && feedbackVisible ? "opens" : `BROKEN (expanded=${open}, items=${feedbackVisible})`;
  if (name === "category") await shot("contact-open");
  await page.mouse.click(10, phone ? 300 : 400);
  await page.waitForTimeout(300);
  r.contactMenu[name] += (await page.getByRole("button", { name: "Contact us" }).getAttribute("aria-expanded")) === "false" ? ", closes on outside tap" : ", DOES NOT CLOSE";
}

// 2. Header stays in view after scrolling down.
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.mouse.wheel(0, 2500);
await page.waitForTimeout(700);
const headerBox = await page.locator("header.ui-site-header").boundingBox();
r.headerVisibleAfterScroll = Boolean(headerBox && headerBox.y >= -1 && headerBox.y < 5);

// 3. Homepage product sections: rows of cards in the first section.
const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Featured" }) }).first();
await center(section.getByRole("heading", { name: "Featured" }));
await page.waitForTimeout(500);
const tops = await section.locator(".ui-rail > div").evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== "none").map((e) => Math.round(e.getBoundingClientRect().top)));
r.homeSectionRows = new Set(tops).size;
r.homeCardsInSection = tops.length;
await section.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
await page.evaluate(() => window.scrollBy({ top: -70, behavior: "instant" }));
await page.waitForTimeout(400);
await shot("home-two-rows");

// 4. Buy: one product from its page, then two more from cards — the page stays put each time.
await page.goto(base + "/product/premium-pakistani-cap-white", { waitUntil: "networkidle" });
await page.locator("main").getByRole("group").first().getByRole("button").and(page.locator(":enabled")).filter({ hasNotText: /out of stock/ }).nth(2).click();
await page.locator("main").getByRole("button", { name: /^add to cart$/i }).first().click();
await page.waitForTimeout(700);
r.pdpAdd = { confirmation: await page.getByTestId("added-to-bag").isVisible(), bagOpened: await page.getByRole("dialog", { name: "Your bag" }).count() };
await shot("added-pdp");

await page.goto(base + "/search?q=amber", { waitUntil: "networkidle" });
const singleCard = page.getByRole("button", { name: "Quick add to cart" }).first();
await center(singleCard);
const before = await page.evaluate(() => window.scrollY);
await singleCard.click({ force: true });
await page.waitForTimeout(800);
r.cardAdd = {
  confirmation: (await page.getByTestId("added-to-bag").textContent().catch(() => ""))?.replace(/\s+/g, " ").slice(0, 120),
  bagOpened: await page.getByRole("dialog", { name: "Your bag" }).count(),
  stayedInPlace: Math.abs((await page.evaluate(() => window.scrollY)) - before) < 5,
};
await shot("added-card");

await page.goto(base + "/category/prayer-caps", { waitUntil: "networkidle" });
const multiCard = page.getByRole("button", { name: "Quick add to cart" }).nth(1);
await center(multiCard);
await multiCard.click({ force: true });
const picker = page.getByRole("dialog").filter({ hasText: "Choose your options" });
await picker.getByRole("group").first().getByRole("button").and(page.locator(":enabled")).first().click();
await picker.getByRole("button", { name: /add to cart/i }).last().click();
await page.waitForTimeout(800);
r.popupAdd = { confirmation: await page.getByTestId("added-to-bag").isVisible(), text: (await page.getByTestId("added-to-bag").textContent().catch(() => ""))?.replace(/\s+/g, " ").slice(0, 140) };
await shot("added-popup");

// 5. The bag, from "View bag".
await page.getByTestId("added-to-bag").getByRole("button", { name: "View bag" }).click();
await page.waitForTimeout(1500);
const bag = page.getByRole("dialog", { name: "Your bag" });
r.bag = {
  open: await bag.isVisible(),
  lines: await bag.getByRole("button", { name: /^Remove / }).count(),
  suggestions: await bag.getByTestId("drawer-suggestions").count(),
  hasContinue: await bag.getByRole("button", { name: "Continue shopping" }).count(),
  delivery: (await bag.getByText(/^Delivery /).textContent().catch(() => null)) ?? null,
};
await shot("bag");
await bag.evaluate((el) => el.querySelector(".overflow-y-auto")?.scrollTo({ top: 9999, behavior: "instant" }));
await page.waitForTimeout(300);
await shot("bag-suggestions");

// 6. Focused checkout.
await bag.getByRole("link", { name: /^Checkout/ }).click();
await page.waitForURL(/\/checkout/);
await page.waitForTimeout(1200);
r.checkout = {
  bottomNav: await page.getByRole("navigation", { name: "Primary" }).count(),
  contactButton: await page.getByRole("button", { name: "Contact us" }).count(),
};
await page.screenshot({ path: path.join(out, `journey-checkout-${width}.png`), fullPage: true });

console.log(JSON.stringify({ r, errors: errors.slice(0, 8) }, null, 1));
await browser.close();
