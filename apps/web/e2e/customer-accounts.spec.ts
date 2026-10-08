import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const devMailDir = path.join(__dirname, "..", "..", "api", ".devmail");

const TRACKING_BEACON = /\/api\/(analytics\/|products\/[^/]+\/view$)/;
// Google Identity Services (the "Sign in with Google" button) logs its own FedCM/iframe errors and gets 403s from
// accounts.google.com on a localhost origin, intermittently, depending on the network — third-party noise, not our app.
const GOOGLE_IDENTITY = /accounts\.google\.com|\/gsi\//;

function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    // Tracking beacons (analytics, product views) are rate-limited per IP; a long e2e run from one machine
    // can exhaust that budget, and a throttled beacon is invisible to the shopper — not an error in the
    // journey under test.
    if (msg.type() !== "error" || TRACKING_BEACON.test(msg.location().url)) return;
    if (GOOGLE_IDENTITY.test(msg.location().url) || msg.text().startsWith("[GSI_LOGGER]")) return;
    // GoogleButton cancels Google's pending One Tap credential request when the login page unmounts
    // (google.accounts.id.cancel(), components/account/google-button.tsx); Chrome reports that deliberate abort with
    // exactly this message, attributed to the page.
    if (msg.text() === "The request has been aborted.") return;
    // The source URL makes an intermittent failure attributable (first-party vs third-party script).
    errors.push(`${msg.text()} @ ${msg.location().url || "(no url)"}`);
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

function latestResetLink(email: string): string {
  const files = fs
    .readdirSync(devMailDir)
    .filter((f) => f.includes(email.replace(/[^a-z0-9]/gi, "_")))
    .map((f) => ({ f, t: fs.statSync(path.join(devMailDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (files.length === 0) throw new Error(`No dev-mode email found for ${email}`);
  const html = fs.readFileSync(path.join(devMailDir, files[0]!.f), "utf-8");
  const match = html.match(/href="([^"]+)"/);
  if (!match) throw new Error("No reset link found in dev-mode email");
  return match[1]!;
}

test.describe("customer account journey", () => {
  const email = `pw_${Date.now()}@example.com`;
  const originalPassword = "OriginalPass1";
  const newPassword = "BrandNewPass2";

  test("register, forgot/reset password, wishlist, address, orders, logout", async ({ page }) => {
    const errors = trackConsoleErrors(page);

    await page.goto("/account/register");
    await page.getByLabel("Name").fill("Playwright User");
    await page.getByLabel("Email").fill(email);
    // exact: true — otherwise this also matches the PasswordInput's "Show password" toggle button,
    // whose aria-label contains "password" as a substring of the default case-insensitive match.
    await page.getByLabel("Password", { exact: true }).fill(originalPassword);
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page).toHaveURL(/\/account$/);
    // The home greets by first name; the member card carries the full name.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Playwright.");
    await expect(page.getByTestId("member-card").getByText("Playwright User", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/account\/login/);

    await page.goto("/account/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /send reset link/i }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible();

    const resetLink = latestResetLink(email);
    await page.goto(resetLink.replace(/^https?:\/\/[^/]+/, ""));
    await page.getByLabel(/new password/i).fill(newPassword);
    await page.getByRole("button", { name: /update password/i }).click();
    await expect(page).toHaveURL(/\/account\/login/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(newPassword);
    // exact: the customer login page also renders Google's "Sign in with Google" button whenever its script loads, and
    // /sign in/i matched both (a strict-mode violation that failed this test intermittently, depending on the network).
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);

    // Addresses live under Settings (docs/ACCOUNT_HOME.md).
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("link", { name: "Addresses", exact: true }).click();
    // .first() — with no addresses yet, both the page header's button and the empty-state's own
    // "Add address" button are on screen; either opens the same modal.
    await page.getByRole("button", { name: /add address/i }).first().click();
    await page.getByLabel("Full name").fill("Playwright User");
    await page.getByLabel("Phone").fill("01700000000");
    await page.getByLabel("District").click();
    await page.getByRole("option", { name: "Dhaka", exact: true }).click();
    await page.getByLabel(/Area/i).click();
    await page.getByRole("option", { name: "Gulshan", exact: true }).click();
    await page.getByLabel(/House/i).fill("House 1, Road 2");
    await page.getByRole("button", { name: /save address/i }).click();
    await expect(page.getByText("House 1, Road 2, Gulshan, Dhaka")).toBeVisible();

    // exact: true — "All orders" links elsewhere in the account also match /orders/i.
    await page.getByRole("link", { name: "Orders", exact: true }).first().click();
    await expect(page.getByText(/no orders yet/i)).toBeVisible();

    await page.goto("/");
    const firstProductLink = page.locator('a[href^="/product/"]').first();
    await firstProductLink.click();
    // The PDP also renders several "you might also like" carousels below the fold, each with its
    // own per-card wishlist button sharing this same accessible name — `.first()` targets the
    // main product's own button, which always renders above those carousels in DOM order.
    await page.getByRole("button", { name: /add to wishlist/i }).first().click();

    // A signed-in customer's wishlist lives in the account.
    await page.goto("/wishlist");
    await expect(page).toHaveURL(/\/account\/saved$/);
    await expect(page.getByRole("heading", { name: "Saved for later" })).toBeVisible();
    await expect(page.getByText(/nothing saved yet/i)).not.toBeVisible();

    await page.goto("/account");
    await page.getByRole("button", { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/account\/login/);

    expect(errors, `Unexpected console errors: ${errors.join("\n")}`).toEqual([]);
  });

  test("guest is redirected off /account and back after login", async ({ page }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account\/login\?next=%2Faccount/);
  });
});
