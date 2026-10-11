// Page-to-page consistency and loading audit. For every storefront and account page, at one width:
//  - layout: the page heading (font, size, weight), where it starts (left edge, distance below the header), content width;
//  - loading: navigating to it in-app from the homepage, what the shopper sees until the real content is there
//    (a skeleton, a spinner, "Loading…" text, or an empty page) and how long that lasts.
//   node scripts/storefront-consistency.mjs <baseUrl> <outDir> <width> [customer.json]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [base, out, widthArg, customerFile] = process.argv.slice(2);
const width = Number(widthArg);
fs.mkdirSync(out, { recursive: true });
const customer = customerFile ? JSON.parse(fs.readFileSync(customerFile, "utf8")) : null;

const ROUTES = [
  "/category/prayer-caps",
  "/product/premium-pakistani-cap-white",
  "/search?q=cap",
  "/search?q=zzzzqqq",
  "/cart",
  "/checkout",
  "/wishlist",
  "/track-order",
  "/contact",
  "/faq",
  "/shipping-returns",
  "/privacy-policy",
  "/terms",
  "/account/login",
  "/account/register",
  "/account/forgot-password",
];
const ACCOUNT = ["/account", "/account/orders", customer ? `/account/orders/${customer.orderId}` : null, "/account/addresses", "/account/saved", "/account/settings", "/account/reward-points", "/account/store-balance", "/account/coupons", "/account/returns", "/account/browsing-history"].filter(Boolean);

const browser = await chromium.launch();

async function run(routes, cookies, label) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 900 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("az_tracking_consent_v1", "denied");
    } catch {}
  });
  if (cookies.length) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const rows = [];
  for (const route of routes) {
   try {
    // In-app navigation from the homepage, the way a shopper moves around.
    await page.goto(base + "/", { waitUntil: "networkidle" });
    const samples = await page.evaluate(async (target) => {
      const states = [];
      const state = () => {
        const main = document.querySelector("main") ?? document.body;
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && s.visibility !== "hidden" && Number(s.opacity) > 0.05;
        };
        const skeleton = [...main.querySelectorAll(".ui-skeleton, [class*='animate-pulse'], [class*='skeleton']")].some(visible);
        const spinner = [...main.querySelectorAll(".animate-spin, [role=progressbar]")].some(visible);
        const loadingText = /\bloading\b/i.test(main.innerText.slice(0, 400));
        const h1 = main.querySelector("h1");
        const empty = main.innerText.trim().length < 15;
        return { url: location.pathname + location.search, skeleton, spinner, loadingText, h1: Boolean(h1 && visible(h1)), empty };
      };
      const t0 = performance.now();
      window.next.router.push(target);
      while (performance.now() - t0 < 4000) {
        await new Promise((r) => setTimeout(r, 50));
        states.push({ t: Math.round(performance.now() - t0), ...state() });
      }
      return states;
    }, route);
    const arrived = samples.filter((s) => s.url === new URL(base + route).pathname + (new URL(base + route).search || ""));
    const settled = arrived.find((s) => s.h1 && !s.skeleton && !s.spinner && !s.loadingText);
    const interim = samples.filter((s) => !settled || s.t < settled.t);
    const shown = [...new Set(interim.flatMap((s) => [s.skeleton && "skeleton", s.spinner && "spinner", s.loadingText && "Loading text", s.empty && s.url !== "/" && "empty page"].filter(Boolean)))];

    // Layout once settled.
    await page.waitForTimeout(400);
    const layout = await page.evaluate(() => {
      const h1 = document.querySelector("main h1") ?? document.querySelector("h1");
      const header = document.querySelector("header.ui-site-header, header");
      if (!h1) return null;
      const r = h1.getBoundingClientRect();
      const s = getComputedStyle(h1);
      let box = h1.parentElement;
      while (box && getComputedStyle(box).maxWidth === "none" && box.tagName !== "MAIN") box = box.parentElement;
      return {
        text: h1.textContent.trim().slice(0, 30),
        srOnly: h1.classList.contains("sr-only") || r.width <= 1,
        font: s.fontFamily.split(",")[0].replace(/["']/g, ""),
        size: s.fontSize,
        weight: s.fontWeight,
        left: Math.round(r.left + window.scrollX),
        belowHeader: Math.round(r.top + window.scrollY - (header ? header.getBoundingClientRect().bottom + window.scrollY : 0)),
        maxWidth: box ? getComputedStyle(box).maxWidth : "none",
      };
    });
    await page.screenshot({ path: path.join(out, `${label}${route.replace(/[/?=]+/g, "_")}-${width}.png`) });
    rows.push({ route, settledMs: settled?.t ?? null, interim: shown, ...layout });
    console.log(
      [route.padEnd(34), String(settled?.t ?? "never").padStart(5) + "ms", (shown.join("+") || "-").padEnd(22), layout ? `${layout.font} ${layout.size}/${layout.weight} left=${layout.left} gap=${layout.belowHeader} max=${layout.maxWidth}${layout.srOnly ? " (sr-only h1)" : ""}` : "NO H1"].join("  "),
    );
   } catch (e) {
    console.log(route.padEnd(34), "(full page load — not an in-app navigation)", String(e.message).split("\n")[0].slice(0, 60));
   }
  }
  await ctx.close();
  return rows;
}

const all = process.env.ACCOUNT_ONLY ? [] : [...(await run(ROUTES, [], "page"))];
if (customer) {
  all.push(
    ...(await run(ACCOUNT, [
      { name: "customer_access_token", value: customer.token, domain: "localhost", path: "/" },
      { name: "csrf_token", value: "local-audit", domain: "localhost", path: "/" },
    ], "account")),
  );
}
fs.writeFileSync(path.join(out, `consistency-${width}.json`), JSON.stringify(all, null, 1));
await browser.close();
