import { test, expect, type Page } from "@playwright/test";

/** P0-03: the Content-Security-Policy (lib/security/csp.ts, applied by middleware.ts). Every page answers with a nonce
 * policy, every executable script Next renders carries that nonce, the main storefront/account/admin screens load with
 * zero CSP violations, and markup injected into a page can't run script. */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";

interface ApiProduct { slug: string; name: string }
interface ApiCategory { slug: string }

/** Records every CSP violation the page reports (installed before any page script runs). */
async function collectViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__cspViolations.push(`${e.effectiveDirective} ← ${e.blockedURI || "inline"}`));
  });
  return () => page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

function scriptDirective(csp: string): string {
  return csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) ?? "";
}

test.setTimeout(120_000);

test("every page response carries a fresh nonce CSP without unsafe script sources", async ({ request }) => {
  const nonces = new Set<string>();
  for (const path of ["/", "/checkout", "/account/login", "/admin/login"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBeLessThan(400);
    const csp = res.headers()["content-security-policy"] ?? "";
    const script = scriptDirective(csp);
    expect(script, path).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/);
    expect(script, path).toContain("'strict-dynamic'");
    expect(script, path).not.toContain("'unsafe-inline'");
    expect(script, path).not.toContain("'unsafe-eval'"); // e2e runs a production build
    for (const d of ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'"]) expect(csp, path).toContain(d);

    // Every script the browser would execute carries this response's nonce (JSON-LD data blocks don't execute).
    const nonce = /'nonce-([^']+)'/.exec(script)![1]!;
    nonces.add(nonce);
    const html = await res.text();
    const executable = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]!).filter((attrs) => !/type="application\/(ld\+)?json"/.test(attrs));
    expect(executable.length, path).toBeGreaterThan(0);
    for (const attrs of executable) expect(attrs, `${path}: <script${attrs}>`).toContain(`nonce="${nonce}"`);
  }
  expect(nonces.size).toBe(4); // never reused across responses
});

test("storefront, account and admin screens load with zero CSP violations", async ({ page }) => {
  const violations = await collectViolations(page);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  const products = ((await (await fetch(`${API}/api/products/storefront?pageSize=5`)).json()) as { items: ApiProduct[] }).items;
  const categories = ((await (await fetch(`${API}/api/categories/tree`)).json()) as { tree: ApiCategory[] }).tree;
  expect(products.length).toBeGreaterThan(0);

  const visits: Array<[string, () => Promise<void>]> = [
    ["/", async () => expect(page.locator("main").first()).toBeVisible()],
    [`/product/${products[0]!.slug}`, async () => expect(page.getByRole("heading", { level: 1, name: products[0]!.name })).toBeVisible()],
    ...(categories[0] ? [[`/category/${categories[0].slug}`, async () => expect(page.getByRole("heading", { level: 1 })).toBeVisible()]] as Array<[string, () => Promise<void>]> : []),
    ["/search?q=a", async () => expect(page.locator("main").first()).toBeVisible()],
    ["/checkout", async () => expect(page.locator("main").first()).toBeVisible()],
    ["/account/login", async () => expect(page.getByRole("button", { name: /sign in|log in/i }).first()).toBeVisible()],
    ["/admin/login", async () => expect(page.getByRole("button", { name: /sign in|log in/i }).first()).toBeVisible()],
  ];
  for (const [path, ready] of visits) {
    await page.goto(path);
    await ready();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    expect(await violations(), `CSP violations on ${path}`).toEqual([]);
  }
  expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
});

test("markup injected into a page can't run script", async ({ page }) => {
  const violations = await collectViolations(page);
  await page.goto("/");
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", `<img src="data:," onerror="window.__xss = 1"><div id="xss-probe"></div>`);
  });
  await expect.poll(violations).toContainEqual(expect.stringMatching(/^script-src/));
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});
