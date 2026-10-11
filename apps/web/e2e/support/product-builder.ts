import { expect, type Page } from "@playwright/test";

/** Shared Product Builder steering for e2e specs — the builder is the one product editor (create and edit). */

export type BuilderStep = "basics" | "media" | "pricing" | "variants" | "care" | "sizeGuide" | "content" | "seo" | "preview" | "review" | "publish";

/** A step's chip in the builder's step track (stable test id, independent of the step's label). */
export const stepChip = (page: Page, id: BuilderStep) => page.getByTestId(`wizard-step-${id}`);

const EDIT_URL = /\/admin\/products\/[^/]+\/edit/;

/** Opens a step on an existing product (every step is reachable once the product exists). */
export async function goToStep(page: Page, id: BuilderStep) {
  await stepChip(page, id).click();
  await expect(stepChip(page, id)).toHaveAttribute("aria-current", "step");
}

/** Before creation, steps unlock as the admin moves forward: Continue until `id` is the current step. */
export async function continueTo(page: Page, id: BuilderStep) {
  for (let i = 0; i < 6; i++) {
    if ((await stepChip(page, id).getAttribute("aria-current").catch(() => null)) === "step") return;
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await expect(stepChip(page, id)).toHaveAttribute("aria-current", "step");
}

const currentStep = (page: Page) => page.locator("[data-testid^='wizard-step-'][aria-current='step']").getAttribute("data-testid");

/** Continues from wherever the new-product flow is until the draft is created, and returns the product's edit path.
 * One Continue per step: after each click it waits for the step to change (or the edit page to load) before deciding
 * whether to click again, so the creating click is never repeated. */
export async function createDraft(page: Page) {
  for (let i = 0; i < 6 && !EDIT_URL.test(new URL(page.url()).pathname); i++) {
    const before = await currentStep(page);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect
      .poll(async () => EDIT_URL.test(new URL(page.url()).pathname) || (await currentStep(page).catch(() => before)) !== before, { timeout: 30_000 })
      .toBe(true);
  }
  await expect(page).toHaveURL(EDIT_URL, { timeout: 30_000 });
  return new URL(page.url()).pathname;
}

/** Opens the builder at `path` with the live preview showing (it starts closed below 1280px, e.g. on phones). */
export async function openBuilderWithPreview(page: Page, path: string) {
  await page.goto(path);
  const toggle = page.getByTestId("toggle-preview");
  await expect(toggle).toHaveAttribute("data-ready", "true"); // the screen-size default has been applied
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(page.getByTestId("preview-frame")).toBeVisible();
}
