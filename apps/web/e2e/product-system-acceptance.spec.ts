/* eslint-disable @typescript-eslint/no-explicit-any -- API bodies are read loosely in an acceptance script */
/**
 * Acceptance run for the product management system, following the brief's ten tests. It drives the real admin UI and the real
 * storefront (and reads the API where a browser can't see something), against whatever the dev database holds.
 *
 * Needs the optional starter presets (Panjabi and Cap types, care guides, Cap size guide, the extra Watch/Shoes fields):
 *     pnpm --filter api db:seed:presets
 * Test 6 (existing products) is `storefront-existing-products.spec.ts`; it is not repeated here.
 */
import { test, expect, type Page } from "@playwright/test";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const API = process.env.E2E_API_URL ?? "http://localhost:4000";

const RUN = String(Date.now()).slice(-8);
const N = {
  panjabi: `E2E Accept Panjabi ${RUN}`,
  cap: `E2E Accept Cap ${RUN}`,
  shoe: `E2E Accept Shoe ${RUN}`,
  watch: `E2E Accept Watch ${RUN}`,
};
const EMBROIDERY = `Embroidery ${RUN}`;
const CARE_A = `Silk care ${RUN}`;
const CARE_B = `Watch strap care ${RUN}`;
const GUIDE = `E2E Cap guide ${RUN}`;
const SLUG = {
  panjabi: `e2e-accept-panjabi-${RUN}`,
};

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

interface VariantSpec { size: string; color: string; stock: number; price?: number }
interface ProductSpec {
  name: string;
  type: string;
  price: number;
  /** [label, value] — a text field, a select option, or "yes" for a switch, whichever the label turns out to be. */
  fields: [string, string][];
  variants: VariantSpec[];
}

/** Fills the new-product form the way an admin would, generates a SKU for every variant and creates the draft. Returns the edit URL. */
async function createProduct(page: Page, p: ProductSpec) {
  await page.goto("/admin/products/new");
  await page.getByLabel("Product name").fill(p.name);
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Product type").selectOption({ label: p.type });
  await page.getByLabel("Short description").fill(`${p.name} — acceptance test product.`);

  for (const [label, value] of p.fields) {
    const control = page.getByLabel(label, { exact: true }).first();
    const tag = await control.evaluate((el) => `${el.tagName}:${(el as HTMLInputElement).type ?? ""}`);
    if (tag.startsWith("SELECT")) await control.selectOption(value);
    else if (tag.endsWith("checkbox")) await control.check();
    else await control.fill(value);
  }

  await page.getByRole("button", { name: "Pricing & Inventory" }).click();
  await page.getByLabel("Base price (BDT)").fill(String(p.price));

  await page.getByRole("button", { name: "Variants", exact: true }).click();
  for (const [i, v] of p.variants.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Add variant manually" }).click();
    await page.locator(`input[name="variants.${i}.size"]`).fill(v.size);
    await page.locator(`input[name="variants.${i}.color"]`).fill(v.color);
    await page.locator(`input[name="variants.${i}.stock"]`).fill(String(v.stock));
    if (v.price) await page.locator(`input[name="variants.${i}.price"]`).fill(String(v.price));
    await page.getByRole("button", { name: "Generate" }).nth(i).click();
    await expect(page.locator(`input[name="variants.${i}.sku"]`)).toHaveValue(/.+/);
  }
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/.+\/edit/, { timeout: 30_000 });
  return new URL(page.url()).pathname;
}

async function uploadImages(page: Page, names: string[]) {
  await page.locator('input[type="file"]').first().setInputFiles(names.map((name) => ({ name, mimeType: "image/png", buffer: PNG })));
  await expect(page.getByLabel("Image caption")).toHaveCount(names.length, { timeout: 30_000 });
}

/** Draft → Ready → Published through the status panel. */
async function publish(page: Page) {
  const panel = page.getByTestId("product-status-panel");
  await panel.getByRole("button", { name: "Mark ready" }).click();
  await expect(panel).toContainText("Ready", { timeout: 15_000 });
  await panel.getByRole("button", { name: "Publish" }).click();
  await expect(panel.getByRole("button", { name: "Unpublish" })).toBeVisible({ timeout: 15_000 });
}

const slugFrom = async (page: Page) => {
  await page.getByRole("button", { name: "SEO", exact: true }).click();
  return page.getByLabel("URL slug").inputValue();
};

async function apiProduct(slug: string) {
  const res = await fetch(`${API}/api/products/slug/${slug}`);
  return res.status === 200 ? ((await res.json()) as { product: any }).product : null;
}

const accordionTitles = (page: Page) => page.locator("button[aria-expanded]").allTextContents().then((t) => t.map((s) => s.trim()));

async function openSizeGuide(page: Page) {
  await page.getByRole("button", { name: /size guide/i }).first().click();
  return page.getByRole("dialog");
}

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

test.describe("product management system — the brief's acceptance tests", () => {
  type Key = "panjabi" | "cap" | "shoe" | "watch";
  const edit = {} as Record<Key, string>;
  const slug = {} as Record<Key, string>;

  test("0. the starter presets are installed", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/new");
    await expect(page.getByLabel("Product type").locator("option", { hasText: "Loading types" })).toHaveCount(0);
    const options = await page.getByLabel("Product type").locator("option").allTextContents();
    for (const t of ["Panjabi", "Cap", "Shoes", "Watch"]) {
      expect(options, `product type "${t}" is missing — run: pnpm --filter api db:seed:presets`).toContain(t);
    }
  });

  /* ── Test 4 (set-up half): a custom attribute, assigned to a type ── */
  test("4a. create a custom attribute and assign it to the Panjabi type", async ({ page }) => {
    await login(page);
    await page.goto("/admin/catalog/attributes");
    await page.getByRole("button", { name: /add attribute/i }).click();
    await page.getByLabel("Label").fill(EMBROIDERY);
    await page.getByLabel("Field type").selectOption("SELECT");
    await page.getByLabel(/Options \(one per line\)/).fill("Hand embroidery\nMachine embroidery\nNone");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(EMBROIDERY).first()).toBeVisible();

    await page.goto("/admin/catalog/templates");
    await page.getByRole("button", { name: "Edit Panjabi template", exact: true }).click();
    await page.getByLabel("Attribute to add").selectOption({ label: `${EMBROIDERY} (Select (one option))` });
    await page.getByRole("button", { name: /^Add$/ }).click();
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  /* ── Test 3 (set-up half): several care presets ── */
  test("3a. create two care presets", async ({ page }) => {
    await login(page);
    await page.goto("/admin/catalog/care-guides");
    for (const [name, steps] of [[CARE_A, "Dry clean only\nStore hanging\nNever wring"], [CARE_B, "Wipe with a soft cloth\nAvoid magnets"]] as const) {
      await page.getByRole("button", { name: /add care guide/i }).click();
      await page.getByLabel("Name", { exact: true }).fill(name);
      await page.getByLabel("Care steps (one per line)").fill(steps);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
  });

  /* ── Test 2 (manager half): create, edit, duplicate, archive, preview, assign ── */
  test("2a. size guide manager: create, edit, duplicate, archive; then assign the guide to the Cap type", async ({ page }) => {
    await login(page);
    await page.goto("/admin/catalog/size-guides");
    await page.getByRole("button", { name: /add size guide/i }).click();
    await page.getByLabel("Name").fill(GUIDE);
    await page.getByLabel("Unit label").fill("cm");
    await page.getByLabel("Column 2 heading").fill("Head circumference");
    await page.getByLabel("Row 1, Head circumference").fill("54–56");
    await page.getByLabel("Row 2, Head circumference").fill("56–58");
    await page.getByLabel("Row 3, Head circumference").fill("58–60");
    await expect(page.getByText("All measurements are in cm.")).toBeVisible(); // the live preview
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: GUIDE, exact: true })).toBeVisible();

    // Edit: change a cell and rename the second column.
    await page.getByRole("button", { name: `Edit ${GUIDE}`, exact: true }).click();
    await page.getByLabel("Column 2 heading").fill("Head size");
    await page.getByLabel("Row 1, Head size").fill("53–55");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: GUIDE, exact: true })).toBeVisible();

    // Duplicate, then archive the copy.
    await page.getByRole("button", { name: `Duplicate ${GUIDE}`, exact: true }).click();
    await expect(page.getByRole("heading", { name: `${GUIDE} copy`, exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Archive ${GUIDE} copy` }).click();
    await expect(page.getByRole("button", { name: `Restore ${GUIDE} copy` })).toBeVisible();

    // Assign to the Cap type: the Cap template now uses this guide.
    await page.goto("/admin/catalog/templates");
    await page.getByRole("button", { name: "Edit Cap template", exact: true }).click();
    await page.getByLabel("Size guide", { exact: true }).selectOption({ label: GUIDE });
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  /* ── Test 1: create a product of each type ── */
  test("1a. Panjabi: the type brings its own fields; colour × size variants with SKUs, stock and a price override", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/new");
    await page.getByLabel("Product type").selectOption({ label: "Panjabi" });
    // The Panjabi template's fields, and only those.
    for (const label of ["Material", "Fabric", "Fit", "Collar", "Sleeve", "Pattern", EMBROIDERY]) await expect(page.getByLabel(label, { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel("Closure Type")).toHaveCount(0);
    await expect(page.getByLabel("Movement")).toHaveCount(0);
    await expect(page.getByText("Show Size Guide on Storefront")).toBeVisible();

    edit.panjabi = await createProduct(page, {
      name: N.panjabi,
      type: "Panjabi",
      price: 1200,
      fields: [["Fabric", "Fine cotton"], ["Fit", "Regular"], ["Collar", "Band"], ["Sleeve", "Full sleeve"], ["Pattern", "Embroidered"], [EMBROIDERY, "Hand embroidery"]],
      variants: [
        { size: "M", color: "Black", stock: 5 },
        { size: "L", color: "Black", stock: 6 },
        { size: "M", color: "White", stock: 7, price: 1400 },
        { size: "L", color: "White", stock: 8, price: 1400 },
      ],
    });
    // Variant 1 and 2 got distinct generated SKUs from the Panjabi code.
    await page.getByRole("button", { name: "Variants", exact: true }).click();
    const skus = await Promise.all([0, 1, 2, 3].map((i) => page.locator(`input[name="variants.${i}.sku"]`).inputValue()));
    expect(new Set(skus).size).toBe(4);
    expect(skus.every((s) => s.includes("PNJ"))).toBe(true);
  });

  test("1b. Panjabi: images per colour, care preset, SEO, FAQ, highlights — then Draft → Ready → Published", async ({ page }) => {
    await login(page);
    await page.goto(edit.panjabi);
    await uploadImages(page, ["black-1.png", "black-2.png", "white-1.png"]);

    await page.getByRole("button", { name: "Variants", exact: true }).click();
    for (const [n, images] of [[1, ["black-1", "black-2"]], [2, ["black-1", "black-2"]], [3, ["white-1"]], [4, ["white-1"]]] as const) {
      const gallery = page.getByRole("group", { name: `Variant ${n} gallery` });
      for (const img of images) await gallery.getByRole("button", { name: new RegExp(`${img}\\.png`) }).click();
    }

    // Test 3: assign a care preset at product level.
    await page.getByRole("button", { name: "Care & Material" }).click();
    await page.getByLabel("Care guide").selectOption({ label: CARE_A });
    await expect(page.getByTestId("care-preview")).toContainText("Store hanging");

    // Test 8: SEO.
    await page.getByRole("button", { name: "SEO", exact: true }).click();
    await page.getByLabel("URL slug").fill(SLUG.panjabi);
    await page.getByLabel("SEO title").fill(`Embroidered Panjabi ${RUN} | Asif Zone`);
    await page.getByLabel("Meta description").fill(`A hand-embroidered black or white panjabi (${RUN}).`);
    await page.getByLabel("Focus keyword").fill(`embroidered panjabi ${RUN}`);
    await page.getByLabel("Canonical URL").fill(`https://example.com/canonical/${RUN}`);
    await page.getByLabel("Social title").fill(`OG title ${RUN}`);
    await page.getByLabel("Social description").fill(`OG description ${RUN}`);
    await page.getByLabel("Social image URL").fill("https://example.com/og.png");

    // Test 7 (set-up half): page content — FAQ, highlights, and a section order/visibility change.
    await page.getByRole("button", { name: "Page content" }).click();
    await page.getByLabel("Highlights visibility").selectOption("true");
    await page.getByLabel("Highlights text").fill("Hand embroidered collar\nBreathable fine cotton");
    await page.getByLabel("Shipping & returns visibility").selectOption("false");
    const up = page.getByRole("button", { name: "Move FAQ up" });
    for (let i = 0; i < 14 && (await up.isEnabled()); i++) await up.click();
    await page.getByRole("button", { name: "Add question" }).click();
    await page.getByLabel("Question 1", { exact: true }).fill("Does the embroidery fade?");
    await page.getByLabel("Answer 1", { exact: true }).fill("No, it is colour-fast.");

    await page.getByTestId("product-status-panel").getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Product saved")).toBeVisible();
    slug.panjabi = SLUG.panjabi;
    await publish(page); // Test 10, first half
  });

  test("1c. Cap: its own fields and the custom size guide", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/new");
    await page.getByLabel("Product type").selectOption({ label: "Cap" });
    for (const label of ["Material", "Closure Type", "Adjustable"]) await expect(page.getByLabel(label, { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel("Collar")).toHaveCount(0);
    edit.cap = await createProduct(page, {
      name: N.cap, type: "Cap", price: 450,
      fields: [["Material", "Cotton twill"], ["Closure Type", "Snapback"], ["Adjustable", "yes"]],
      variants: [{ size: "M", color: "Navy", stock: 12 }],
    });
    await uploadImages(page, ["cap.png"]);
    // Test 2: product-level override — this cap says 53–55 becomes 52–54, in its own table, without touching the preset.
    await page.getByRole("button", { name: "Basic Info" }).click();
    await expect(page.getByText(/Using the .* size guide from Cap/)).toBeVisible();
    await page.locator('input[value="53–55"]').first().fill("52–54");
    await page.getByTestId("product-status-panel").getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Product saved")).toBeVisible();
    slug.cap = await slugFrom(page);
    await publish(page);
  });

  test("1d. Shoe: its own fields and the shoe size guide", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/new");
    await page.getByLabel("Product type").selectOption({ label: "Shoes" });
    for (const label of ["Shoe Type", "Sole Material", "Fit"]) await expect(page.getByLabel(label, { exact: true }).first()).toBeVisible();
    edit.shoe = await createProduct(page, {
      name: N.shoe, type: "Shoes", price: 2400,
      fields: [["Material", "Leather"], ["Shoe Type", "Loafer"], ["Sole Material", "Rubber"]],
      variants: [{ size: "42", color: "Brown", stock: 4 }],
    });
    await uploadImages(page, ["shoe.png"]);
    // Test 3: a product-specific care override (not a preset).
    await page.getByRole("button", { name: "Care & Material" }).click();
    await page.getByLabel("Write custom care steps for this product").check();
    await page.getByLabel("Care steps (one per line)").fill("Use a shoe tree\nPolish monthly");
    await page.getByTestId("product-status-panel").getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Product saved")).toBeVisible();
    slug.shoe = await slugFrom(page);
    await publish(page);
  });

  test("1e. Watch: its own fields, no size guide, a different care preset", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/new");
    await page.getByLabel("Product type").selectOption({ label: "Watch" });
    for (const label of ["Movement", "Dial Size", "Case Material", "Strap Material", "Water Resistance", "Glass", "Warranty"]) {
      await expect(page.getByLabel(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Show Size Guide on Storefront")).toHaveCount(0);
    edit.watch = await createProduct(page, {
      name: N.watch, type: "Watch", price: 5200,
      fields: [["Dial Size", "40"], ["Case Material", "Stainless Steel"], ["Strap Material", "Genuine Leather"], ["Glass", "Sapphire Crystal"], ["Water Resistance", "50m"], ["Warranty", "2 years"]],
      variants: [{ size: "40mm", color: "Silver", stock: 3 }],
    });
    await uploadImages(page, ["watch.png"]);
    await page.getByRole("button", { name: "Care & Material" }).click();
    await page.getByLabel("Care guide").selectOption({ label: CARE_B });
    await page.getByTestId("product-status-panel").getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Product saved")).toBeVisible();
    slug.watch = await slugFrom(page);
    await publish(page);
  });

  /* ── Storefront: Tests 1 (rendering), 2, 3, 4, 7, 8 ── */
  test("2b. size guides render on the storefront: apparel, cap (with the override), shoe; none for the watch", async ({ page }) => {
    await page.goto(`/product/${slug.panjabi}`);
    let dialog = await openSizeGuide(page);
    await expect(dialog.getByRole("columnheader", { name: "Chest" })).toBeVisible(); // Apparel size guide
    await page.keyboard.press("Escape");

    await page.goto(`/product/${slug.cap}`);
    dialog = await openSizeGuide(page);
    await expect(dialog.getByRole("columnheader", { name: "Head size" })).toBeVisible(); // the custom guide assigned to the type, edited in step 2a
    await expect(dialog.getByRole("cell", { name: "52–54" })).toBeVisible(); // this product's own override
    await expect(dialog.getByRole("cell", { name: "56–58" })).toBeVisible(); // the rest still comes from the preset
    await expect(dialog.getByRole("columnheader", { name: "Chest" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto(`/product/${slug.shoe}`);
    dialog = await openSizeGuide(page);
    await expect(dialog.getByRole("columnheader", { name: "Foot length" })).toBeVisible(); // Shoe size guide
    await page.keyboard.press("Escape");

    await page.goto(`/product/${slug.watch}`);
    await expect(page.getByRole("heading", { level: 1, name: N.watch })).toBeVisible();
    await expect(page.getByRole("button", { name: /size guide/i })).toHaveCount(0);
  });

  test("3b. care presets render on the storefront: a preset, a product override, another preset", async ({ page }) => {
    for (const [s, step] of [[slug.panjabi, "Store hanging"], [slug.shoe, "Polish monthly"], [slug.watch, "Avoid magnets"]] as const) {
      await page.goto(`/product/${s}`);
      await page.getByRole("button", { name: /care instructions/i }).click();
      await expect(page.getByText(step)).toBeVisible();
    }
    await page.goto(`/product/${slug.panjabi}`);
    await page.getByRole("button", { name: /care instructions/i }).click();
    await expect(page.getByText("Avoid magnets")).toHaveCount(0); // presets don't leak between products
  });

  test("4b. the custom attribute and every type's fields render on the storefront", async ({ page }) => {
    await page.goto(`/product/${slug.panjabi}`);
    await page.getByRole("button", { name: /^specifications$/i }).click();
    for (const text of [`${EMBROIDERY}:`, "Hand embroidery", "Collar:", "Band", "Pattern:", "Embroidered", "Fine cotton"]) await expect(page.getByText(text).first()).toBeVisible();

    await page.goto(`/product/${slug.cap}`);
    await page.getByRole("button", { name: /^specifications$/i }).click();
    await expect(page.getByText("Closure Type:")).toBeVisible();
    await expect(page.getByText("Snapback").first()).toBeVisible();

    await page.goto(`/product/${slug.shoe}`);
    await page.getByRole("button", { name: /^specifications$/i }).click();
    await expect(page.getByText("Shoe Type:")).toBeVisible();
    await expect(page.getByText("Loafer").first()).toBeVisible();

    await page.goto(`/product/${slug.watch}`);
    await page.getByRole("button", { name: /^specifications$/i }).click();
    for (const text of ["Strap Material:", "Genuine Leather", "Glass:", "Sapphire Crystal", "Warranty:", "2 years"]) await expect(page.getByText(text).first()).toBeVisible();
  });

  test("7. page sections: enabled ones render, disabled ones don't, and the order follows the settings", async ({ page }) => {
    await page.goto(`/product/${slug.panjabi}`);
    const titles = await accordionTitles(page);
    for (const shown of ["FAQ", "Description", "Highlights", "Specifications", "Care instructions"]) expect(titles, `"${shown}" should render`).toContain(shown);
    for (const hidden of ["Shipping & Returns", "Warranty", "Returns", "What's included", "Product video"]) expect(titles, `"${hidden}" should not render`).not.toContain(hidden);
    expect(titles.indexOf("FAQ")).toBe(0); // moved to the top for this product
    expect(titles.indexOf("Description")).toBeLessThan(titles.indexOf("Highlights"));
    await page.getByRole("button", { name: "Highlights", exact: true }).click();
    await expect(page.getByText("Breathable fine cotton")).toBeVisible();

    // A product that changed nothing keeps the default order and the default shipping text.
    await page.goto(`/product/${slug.watch}`);
    const defaults = await accordionTitles(page);
    expect(defaults.indexOf("Description")).toBeLessThan(defaults.indexOf("Shipping & Returns"));
    expect(defaults).not.toContain("FAQ"); // no questions written, so the row is hidden
  });

  test("8. SEO: title, description, slug, canonical and Open Graph data reach the live page", async ({ page }) => {
    await page.goto(`/product/${slug.panjabi}`);
    await expect(page).toHaveURL(new RegExp(`/product/${SLUG.panjabi}$`)); // the slug the admin chose
    await expect.poll(() => page.title()).toContain(`Embroidered Panjabi ${RUN} | Asif Zone`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", `A hand-embroidered black or white panjabi (${RUN}).`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://example.com/canonical/${RUN}`);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", `OG title ${RUN}`);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", `OG description ${RUN}`);
    await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /example\.com\/og\.png/);
    const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t));
    expect(ld.find((j) => j["@type"] === "Product")?.name).toBe(N.panjabi);
    expect(ld.find((j) => j["@type"] === "FAQPage")?.mainEntity?.[0]?.name).toBe("Does the embroidery fade?");
  });

  test("5. colour × size variants: selection, price, images, cart, checkout, order, stock", async ({ page }) => {
    const before = await apiProduct(slug.panjabi);
    const target = before.variants.find((v: any) => v.color === "White" && v.size === "L");
    expect(target.sku).toContain("PNJ");

    await page.goto(`/product/${slug.panjabi}`);
    // A colour picks the gallery; a full colour + size combination picks the variant, and with it the price.
    await page.getByRole("button", { name: "Black", exact: true }).click();
    await expect(page.getByRole("button", { name: /^View image \d of/ })).toHaveCount(2); // black's own gallery
    await page.getByRole("button", { name: "M", exact: true }).first().click();
    await expect(page.getByTestId("product-price")).toContainText("1,200"); // no override: the base price
    await page.getByRole("button", { name: "White", exact: true }).click();
    await expect(page.getByRole("img", { name: "white-1.png" }).first()).toBeVisible(); // white's own image
    await page.getByRole("button", { name: "L", exact: true }).first().click();
    await expect(page.getByTestId("product-price")).toContainText("1,400"); // the variant's price override

    await page.getByRole("button", { name: "Add to Cart" }).first().click();
    await expect(page.getByText(/added to cart/i).first()).toBeVisible();

    await page.goto("/cart");
    await expect(page.getByText(N.panjabi).first()).toBeVisible();
    await expect(page.getByText("1,400").first()).toBeVisible();

    await page.goto("/checkout");
    await page.getByLabel("Full name").fill("E2E Acceptance Shopper");
    await page.getByLabel("Phone").fill("01712345670");
    await page.getByLabel("District").fill("Dhaka");
    await page.getByRole("option", { name: "Dhaka", exact: true }).first().click();
    await page.getByLabel("Area / Thana").fill("Dhanmondi");
    await page.getByRole("option", { name: /Dhanmondi/ }).first().click();
    await page.getByLabel("House / Road / Details").fill("House 1, Road 2 (automated acceptance order)");
    await page.getByLabel("Cash on Delivery").check();
    await page.getByRole("button", { name: /^Place Order/ }).click();
    await expect(page).toHaveURL(/\/order-confirmation\/.+/, { timeout: 30_000 });
    await expect(page.getByText(N.panjabi).first()).toBeVisible();

    // The order took exactly one unit from exactly that variant, at the variant's price.
    const after = await apiProduct(slug.panjabi);
    for (const v of before.variants) {
      const now = after.variants.find((x: any) => x.id === v.id);
      expect(now.stock, `stock of ${v.sku}`).toBe(v.id === target.id ? v.stock - 1 : v.stock);
    }
    await login(page);
    await page.goto("/admin/orders");
    await expect(page.getByText("E2E Acceptance Shopper").locator("visible=true").first()).toBeVisible(); // a table row (desktop) or a card (mobile)
  });

  test("9. duplication: data copied, unique SKUs and slug, inventory not duplicated", async ({ page }) => {
    await login(page);
    await page.goto(edit.panjabi);
    await page.getByRole("button", { name: "Duplicate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create draft copy" }).click();
    const result = page.getByTestId("duplicate-result");
    await expect(result).toContainText("4 variants");
    await expect(result).toContainText("3 images");
    await result.getByRole("link", { name: "Open the copy" }).click();
    await page.waitForURL((u) => /\/admin\/products\/.+\/edit$/.test(u.pathname) && u.pathname !== edit.panjabi);
    const copyUrl = new URL(page.url()).pathname;

    await expect(page.getByLabel("Product name")).toHaveValue(`${N.panjabi} (copy)`);
    await expect(page.getByTestId("product-status-panel")).toContainText("Draft");
    // Type attributes and care came along.
    await expect(page.getByLabel(EMBROIDERY, { exact: true })).toHaveValue("Hand embroidery");
    // "Open the copy" goes to the step-by-step editor: move between its steps, not the classic tabs.
    await page.getByTestId("wizard-step-care").click();
    await expect(page.getByLabel("Care guide").locator("option:checked")).toHaveText(CARE_A);

    await page.getByTestId("wizard-step-variants").click();
    const copySkus = await Promise.all([0, 1, 2, 3].map((i) => page.locator(`input[name="variants.${i}.sku"]`).inputValue()));
    const original = (await apiProduct(slug.panjabi)).variants.map((v: any) => v.sku);
    expect(new Set(copySkus).size).toBe(4);
    for (const s of copySkus) expect(original).not.toContain(s); // SKUs are unique across the catalog
    for (let i = 0; i < 4; i++) await expect(page.locator(`input[name="variants.${i}.stock"]`)).toHaveValue("0"); // stock is not doubled
    await expect(page.locator('input[name="variants.2.price"]')).toHaveValue("1400"); // prices are

    await page.getByTestId("wizard-step-seo").click();
    const slugOfCopy = await page.getByLabel("URL slug").inputValue();
    expect(slugOfCopy).not.toBe(SLUG.panjabi);
    expect((await fetch(`${API}/api/products/slug/${slugOfCopy}`)).status).toBe(404); // a draft is not public

    // The original still has its own stock and SKUs.
    const still = await apiProduct(slug.panjabi);
    expect(still.variants.map((v: any) => v.sku).sort()).toEqual([...original].sort());
    void copyUrl;
  });

  test("11. security: script and event-handler payloads in admin-written content don't execute on the storefront", async ({ page }) => {
    const payload = `<img src=x onerror="window.__xss = 'img'"><script>window.__xss = 'script'</script><a href="javascript:window.__xss='link'">click</a>Safe words`;
    await login(page);
    await page.goto(edit.panjabi);
    await page.getByRole("button", { name: "Page content" }).click();
    await page.getByLabel("Highlights text").fill(payload);
    await page.getByLabel("Answer 1", { exact: true }).fill(payload);
    await page.getByTestId("product-status-panel").getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByText("Product saved")).toBeVisible();

    // The preview renders the same page component as the live one, straight from the database (the live page is cached for a minute).
    let dialogs = 0;
    page.on("dialog", async (d) => {
      dialogs++;
      await d.dismiss();
    });
    const id = edit.panjabi.split("/")[3];
    await page.goto(`/preview/${id}`);
    await page.getByRole("button", { name: "Highlights", exact: true }).click();
    await page.getByRole("button", { name: "FAQ", exact: true }).click();
    await expect(page.getByText("Safe words").first()).toBeVisible(); // the harmless text survives sanitising
    await page.waitForTimeout(500); // give any injected handler a chance to fire

    expect(dialogs).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: string }).__xss)).toBeUndefined();
    expect(await page.locator("main [onerror], main [onclick], main a[href^='javascript:']").count()).toBe(0);
    expect(await page.locator("main script").filter({ hasText: "__xss" }).count()).toBe(0);
    // The admin's own list and editor show the raw text as text, too (React escapes it).
    await page.goto(`${edit.panjabi}`);
    await page.getByRole("button", { name: "Page content" }).click();
    await expect(page.getByLabel("Highlights text")).toHaveValue(payload);

    // The live page also writes structured data (JSON-LD) from the same text, which the preview does not. A "</script>" in a FAQ
    // answer once ended that <script> early and let the rest of the text into the page as HTML. Checked on a product nobody has
    // opened yet, so the public page cache can't hide the result.
    const fresh = await createProduct(page, { name: `E2E Accept XSS ${RUN}`, type: "Cap", price: 300, fields: [], variants: [{ size: "M", color: "Navy", stock: 2 }] });
    void fresh;
    await uploadImages(page, ["xss.png"]);
    await page.getByRole("button", { name: "Page content" }).click();
    await page.getByRole("button", { name: "Add question" }).click();
    await page.getByLabel("Question 1", { exact: true }).fill("Is it safe?");
    await page.getByLabel("Answer 1", { exact: true }).fill(payload);
    await page.getByTestId("product-status-panel").getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Product saved")).toBeVisible();
    const freshSlug = await slugFrom(page);
    await publish(page);

    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(`/product/${freshSlug}`);
    await expect(page.getByRole("heading", { level: 1, name: `E2E Accept XSS ${RUN}` })).toBeVisible();
    await page.getByRole("button", { name: "FAQ", exact: true }).click();
    await expect(page.getByText("Safe words").first()).toBeVisible();
    await page.waitForTimeout(500);

    // Every structured-data block is still valid JSON, and the answer is in it as data.
    const blocks = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t));
    const faq = blocks.find((b) => b["@type"] === "FAQPage");
    expect(faq.mainEntity[0].acceptedAnswer.text).toContain("Safe words");
    expect(dialogs).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: string }).__xss)).toBeUndefined();
    expect(await page.locator("body [onerror], body a[href^='javascript:']").count()).toBe(0);
    expect(pageErrors, "no hydration or script errors on the live page").toEqual([]);
  });

  test("12. the product page shows units sold in the last 7 days to a logged-in admin only", async ({ page, browser, isMobile }) => {
    const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000"; // contexts made by hand don't inherit the project's baseURL
    // Step 5 placed one order for one unit of this product.
    await login(page); // the admin area marks this browser as an admin's while its session is verified
    await page.goto(`/product/${slug.panjabi}`);
    const panel = page.getByTestId("admin-sales-7d");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Admin only");
    await expect(page.getByTestId("admin-sales-7d-units")).toHaveText("1");
    await panel.getByText("By variant").click();
    await expect(panel).toContainText("White"); // the variant that sold
    // Signing out removes it again.
    await page.goto("/admin/dashboard");
    if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await page.goto(`/product/${slug.panjabi}`);
    await expect(page.getByRole("heading", { level: 1, name: N.panjabi })).toBeVisible();
    await expect(page.getByTestId("admin-sales-7d")).toHaveCount(0);

    // An ordinary visitor: no panel, and their browser never even asks for it.
    const visitor = await browser.newContext({ baseURL });
    const vp = await visitor.newPage();
    const asked: string[] = [];
    vp.on("request", (r) => r.url().includes("/sales-summary") && asked.push(r.url()));
    await vp.goto(`/product/${slug.panjabi}`);
    await expect(vp.getByRole("heading", { level: 1, name: N.panjabi })).toBeVisible();
    await vp.waitForTimeout(800);
    await expect(vp.getByTestId("admin-sales-7d")).toHaveCount(0);
    await expect(vp.getByText(/sold in the last 7 days/i)).toHaveCount(0);
    expect(asked, "customers make no request for admin figures").toEqual([]);

    // Someone who forges the browser marker without a session gets nothing: the API refuses, and the marker is dropped.
    const forger = await browser.newContext({ baseURL });
    await forger.addCookies([{ name: "az_admin_hint", value: "1", url: baseURL }]);
    const fp = await forger.newPage();
    const answers: number[] = [];
    fp.on("response", (r) => r.url().includes("/sales-summary") && answers.push(r.status()));
    await fp.goto(`/product/${slug.panjabi}`);
    await expect(fp.getByRole("heading", { level: 1, name: N.panjabi })).toBeVisible();
    await expect.poll(() => answers.length).toBeGreaterThan(0);
    expect(answers[0]).toBe(401);
    await expect(fp.getByTestId("admin-sales-7d")).toHaveCount(0);
    await expect.poll(() => fp.evaluate(() => document.cookie.includes("az_admin_hint=1"))).toBe(false);
    await visitor.close();
    await forger.close();
  });

  test("10. publishing: Draft → Ready → Published → Unpublished, and back", async ({ page }) => {
    await login(page);
    await page.goto(edit.cap);
    const panel = page.getByTestId("product-status-panel");
    expect((await apiProduct(slug.cap))?.name).toBe(N.cap); // published in 1c

    await panel.getByRole("button", { name: "Unpublish" }).click();
    await expect(panel).toContainText("Unpublished", { timeout: 15_000 });
    expect(await apiProduct(slug.cap)).toBeNull(); // gone from the API at once

    await panel.getByRole("button", { name: "Publish" }).click();
    await expect(panel.getByRole("button", { name: "Unpublish" })).toBeVisible({ timeout: 15_000 });
    expect((await apiProduct(slug.cap))?.name).toBe(N.cap);
  });
});
