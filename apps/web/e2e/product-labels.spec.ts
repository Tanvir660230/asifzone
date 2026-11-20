import { test, expect, type Page } from "@playwright/test";
import * as zx from "@zxing/library";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LabelBatchView, ProductLabelVariant } from "@clothing-brand/shared";

// Product stickers (Orders → Product labels). The page is real; variants and supplier lists come from page.route, so the
// stickers carry the hard cases (XXXL, a long colour, a real EAN, a product without a sticker name) without touching
// the database. Checked on what the printer is sent:
//   - 50 × 25: every sticker is a bitmap of exactly the printer's dots (400 × 200 at 203 dpi, 591 × 295 at 300 dpi),
//     pure black and white, and zxing reads both its Code 128 and its QR as the variant's code;
//   - print layout: one sticker per page at exactly the sticker size, and the PDF has one page per sticker;
//   - a supplier list prints the received counts (ordered where nothing was counted).
// Each sticker image is written to test-results/product-labels/ for a human look.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const outDir = path.join("test-results", "product-labels");

function variant(id: string, o: Partial<ProductLabelVariant> & { sku: string; size: string; color: string }): ProductLabelVariant {
  return {
    variantId: id,
    productId: `p-${o.color}`,
    productName: `Haven Sleeveless Jacket – ${o.color}`,
    categoryName: "Jackets",
    barcode: null,
    price: 1390,
    code: o.barcode ?? o.sku,
    labelName: "Haven Jacket",
    labelTag: "Sleeveless",
    colorHex: null,
    sortOrder: 0,
    ...o,
  };
}

const SIZES = ["M", "L", "XL", "XXL", "XXXL"];
const BLACK = SIZES.map((s, i) => variant(`blk-${s}`, { sku: `TH-HVS-BLK-${s}`, size: s, color: "Black", productId: "p-blk", sortOrder: i }));
const VARIANTS: ProductLabelVariant[] = [
  ...BLACK,
  variant("nvy-xl", { sku: "TH-HVS-NVY-XL", size: "XL", color: "Navy Blue", productId: "p-nvy", sortOrder: 2 }),
  variant("fs-m", { sku: "TH-HVF-BRN-M", size: "M", color: "Coffee", productId: "p-fs", productName: "Haven Full-Sleeve Jacket – Coffee", labelTag: "Full Sleeve" }),
  variant("ean", { sku: "AZ-ATR-1", barcode: "8901234567890", size: "6 ml", color: "Oud", productId: "p-attar", productName: "Attar Oud", labelName: null, labelTag: null }),
];

const LIST: LabelBatchView = {
  id: "list-1",
  name: "YG 20 Nov",
  supplier: "YG Fashion",
  notes: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ordered: 9,
  toPrint: 8,
  received: true,
  lines: [
    { variantId: "blk-M", qtyOrdered: 6, qtyReceived: 5, variant: BLACK[0]! },
    { variantId: "blk-L", qtyOrdered: 3, qtyReceived: null, variant: BLACK[1]! },
  ],
};

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

/** Decodes one sticker bitmap (a PNG data URL) the way a scanner would see it: enlarged, nothing smoothed. */
async function decodeSticker(page: Page, url: string) {
  const { w, h, lum } = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const k = 2, pad = 24;
    const c = document.createElement("canvas");
    c.width = img.width * k + 2 * pad;
    c.height = img.height * k + 2 * pad;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(img, pad, pad, img.width * k, img.height * k);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    // One byte a pixel, sent as base64 — a JSON array of millions of numbers is what made this slow.
    let bin = "";
    for (let i = 0; i < d.length; i += 4) bin += String.fromCharCode(d[i]!);
    return { w: c.width, h: c.height, lum: btoa(bin) };
  }, url);
  const source = new zx.RGBLuminanceSource(new Uint8ClampedArray(Buffer.from(lum, "base64")), w, h);
  const read = (fmt: number) => {
    const r = new zx.MultiFormatReader();
    r.setHints(new Map<number, unknown>([[zx.DecodeHintType.POSSIBLE_FORMATS, [fmt]], [zx.DecodeHintType.TRY_HARDER, true]]));
    try {
      return r.decode(new zx.BinaryBitmap(new zx.HybridBinarizer(source))).getText();
    } catch {
      return null;
    }
  };
  return { qr: read(zx.BarcodeFormat.QR_CODE), bar: read(zx.BarcodeFormat.CODE_128) };
}

test.describe("product stickers", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/warehouse/product-labels?**", (route) => route.fulfill({ json: { variants: VARIANTS } }));
    await page.route("**/api/warehouse/print-runs", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 201, json: { run: {} } }) : route.fallback()));
    await page.route("**/api/warehouse/label-batches", (route) => route.fulfill({ json: { batches: [{ ...LIST, lines: undefined }] } }));
    await page.route("**/api/warehouse/label-batches/list-1", (route) => route.fulfill({ json: { batch: LIST } }));
    await login(page);
    await page.goto("/admin/orders/product-labels");
  });

  for (const dpi of [203, 300] as const) {
    test(`50 × 25 at ${dpi} dpi: dot-exact black-and-white stickers whose barcode and QR read back`, async ({ page }) => {
      test.slow(); // decodes every sticker's barcode and QR
      await page.getByRole("searchbox", { name: "Search products to label" }).fill("haven");
      await page.getByRole("button", { name: "Add all" }).click();
      await page.getByRole("button", { name: "50 × 25 mm" }).click();
      await page.getByRole("button", { name: `${dpi} dpi` }).click();
      await expect(page.getByRole("button", { name: `Print ${VARIANTS.length} labels` })).toBeEnabled();

      await page.emulateMedia({ media: "print" });
      const stickers = page.getByTestId("product-sticker");
      await expect(stickers).toHaveCount(VARIANTS.length);
      const shots = await stickers.evaluateAll((els) =>
        els.map((el) => {
          const img = el as HTMLImageElement;
          const r = img.getBoundingClientRect();
          return { code: img.dataset.code!, url: img.src, w: img.naturalWidth, h: img.naturalHeight, wMm: r.width / (96 / 25.4), hMm: r.height / (96 / 25.4) };
        }),
      );
      const dir = path.join(outDir, `50x25-${dpi}`);
      mkdirSync(dir, { recursive: true });
      for (const s of shots) {
        expect.soft([s.w, s.h], s.code).toEqual(dpi === 203 ? [400, 200] : [591, 295]);
        expect.soft(s.wMm, s.code).toBeCloseTo(50, 1);
        expect.soft(s.hMm, s.code).toBeCloseTo(25, 1);
        const pure = await page.evaluate(async (src) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext("2d")!;
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          for (let i = 0; i < d.length; i += 4) if ((d[i] !== 0 && d[i] !== 255) || d[i] !== d[i + 1] || d[i] !== d[i + 2]) return false;
          return true;
        }, s.url);
        expect.soft(pure, `${s.code} is pure black and white`).toBe(true);
        const decoded = await decodeSticker(page, s.url);
        expect.soft(decoded, `${s.code} reads back`).toEqual({ qr: s.code, bar: s.code });
        writeFileSync(path.join(dir, `${s.code}.png`), Buffer.from(s.url.split(",")[1]!, "base64"));
      }

      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      writeFileSync(path.join(dir, "stickers.pdf"), pdf);
      const text = pdf.toString("latin1");
      expect((text.match(/\/Type\s*\/Page(?!s)/g) ?? []).length).toBe(VARIANTS.length);
      const box = text.match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/);
      expect(Number(box?.[1])).toBeCloseTo((50 * 72) / 25.4, 0);
      expect(Number(box?.[2])).toBeCloseTo((25 * 72) / 25.4, 0);
    });
  }

  test("a supplier list prints the received counts, ordered where nothing was counted", async ({ page }) => {
    await page.getByRole("button", { name: "Supplier lists" }).click();
    await page.getByRole("button", { name: /YG 20 Nov/ }).click();
    await expect(page.getByRole("button", { name: "Print 8 stickers" })).toBeVisible();
    // The received view: M shows what arrived (5); L is blank and shows the ordered 3 as its placeholder.
    await expect(page.getByLabel("Haven Jacket Black M, received")).toHaveValue("5");
    await expect(page.getByLabel("Haven Jacket Black L, received")).toHaveAttribute("placeholder", "3");
    await page.getByRole("button", { name: "Print 8 stickers" }).click();
    await page.getByRole("button", { name: "50 × 25 mm" }).click();
    await expect(page.getByRole("button", { name: "Print 8 labels" })).toBeEnabled();
    await page.emulateMedia({ media: "print" });
    const codes = await page.getByTestId("product-sticker").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.code));
    expect(codes).toEqual([...Array(5).fill("TH-HVS-BLK-M"), ...Array(3).fill("TH-HVS-BLK-L")]);
  });

  test("the classic 50 × 30 sticker still prints one page per piece", async ({ page }) => {
    await page.getByRole("searchbox", { name: "Search products to label" }).fill("haven");
    await page.getByRole("button", { name: "Add all" }).click();
    await page.getByRole("button", { name: "50 × 30 mm" }).click();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("product-sticker")).toHaveCount(VARIANTS.length);
    const pdf = (await page.pdf({ preferCSSPageSize: true })).toString("latin1");
    expect((pdf.match(/\/Type\s*\/Page(?!s)/g) ?? []).length).toBe(VARIANTS.length);
  });
});
