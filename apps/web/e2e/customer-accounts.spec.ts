import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const devMailDir = path.join(__dirname, "..", "..", "api", ".devmail");

function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
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
    await expect(page.getByText(/Hi, Playwright/i)).toBeVisible();

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
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/account$/);

    await page.getByRole("link", { name: /addresses/i }).click();
    await page.getByRole("button", { name: /add address/i }).click();
    await page.getByLabel("Full name").fill("Playwright User");
    await page.getByLabel("Phone").fill("01700000000");
    await page.getByLabel("District").click();
    await page.getByRole("option", { name: "Dhaka", exact: true }).click();
    await page.getByLabel(/Area/i).click();
    await page.getByRole("option", { name: "Gulshan", exact: true }).click();
    await page.getByLabel(/House/i).fill("House 1, Road 2");
    await page.getByRole("button", { name: /save address/i }).click();
    await expect(page.getByText("House 1, Road 2, Gulshan, Dhaka")).toBeVisible();

    await page.getByRole("link", { name: /orders/i }).click();
    await expect(page.getByText(/no orders yet/i)).toBeVisible();

    await page.goto("/");
    const firstProductLink = page.locator('a[href^="/product/"]').first();
    await firstProductLink.click();
    // The PDP also renders several "you might also like" carousels below the fold, each with its
    // own per-card wishlist button sharing this same accessible name — `.first()` targets the
    // main product's own button, which always renders above those carousels in DOM order.
    await page.getByRole("button", { name: /add to wishlist/i }).first().click();

    await page.goto("/account/wishlist");
    await expect(page.locator("main")).not.toContainText(/empty wishlist/i);

    await page.getByRole("button", { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/account\/login/);

    expect(errors, `Unexpected console errors: ${errors.join("\n")}`).toEqual([]);
  });

  test("guest is redirected off /account and back after login", async ({ page }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account\/login\?next=%2Faccount/);
  });
});
