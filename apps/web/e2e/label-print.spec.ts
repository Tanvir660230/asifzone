import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildLabelOrders, makeLogoPng } from "./fixtures/label-orders";
import { LABEL_TEMPLATES, resolveGeometry } from "../lib/label-templates";
import { LABEL_RENDER_SCALE } from "../lib/label-fit";

// Shipping-label printing, every template × the hardest real-world orders (fixtures/label-orders.json): the page and
// the capture → PDF pipeline are real; only the orders come from page.route, so no database is touched.
//
// For each template it checks what "lekha kete jay" means on paper:
//   - nothing inside a label runs past the label's edge (the capture cuts it off),
//   - no text field is cut short by an ellipsis or a line clamp,
//   - the captured image lays out like the on-screen label the fit engine measured (same lines, same place),
//   - the page's fit report finds every order fits,
//   - the PDF has one page per sticker (or sheet) at exactly the template's size in points.
// Each captured label is written to test-results/label-print/<template>/<order>.png for a human look.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const outDir = path.join("test-results", "label-print");
const orders = buildLabelOrders();
const VIEWPORT = { width: 3000, height: 4300 };
const api = process.env.E2E_API_URL ?? "http://localhost:4000";
/** Measured with the row-density metric below: at the real 8× layout scale the worst label differs by 0.8% of rows
 * (Windows); with the layout drift the 8× scale fixes (layout at 1×), several labels reach 2.5-4%. 2% sits between,
 * with room for Linux CI rendering a little differently. */
const MAX_LINE_DRIFT = 0.02;
const LOGO_URL = `${api}/__e2e/label-logo.png`;

/** Whether this template's cell, at the 8× layout size, fits the test viewport for an element screenshot. */
function geometryFits(template: (typeof LABEL_TEMPLATES)[number]): boolean {
  const g = resolveGeometry(template, "portrait", template.defaultMarginMm);
  const px = (mm: number) => (mm * LABEL_RENDER_SCALE * 96) / 25.4;
  return px(g.cellWmm) <= VIEWPORT.width && px(g.cellHmm) <= VIEWPORT.height;
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

interface LabelProblem {
  order: string;
  kind: "clipped" | "cut-short";
  text: string;
  px: number;
}

/** Walks every captured label node: anything whose box ends past the label's own box is clipped off the printed image;
 * anything whose content is wider/taller than its own box (truncate, line-clamp) is text cut short. */
function findProblems(page: Page): Promise<LabelProblem[]> {
  return page.evaluate(() => {
    const problems: LabelProblem[] = [];
    document.querySelectorAll<HTMLElement>("[data-testid=label-capture-host] [data-label-order]").forEach((label) => {
      const box = label.getBoundingClientRect();
      const order = label.dataset.labelOrder ?? "?";
      label.querySelectorAll<HTMLElement>("*").forEach((el) => {
        if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const past = Math.max(r.bottom - box.bottom, r.right - box.right, box.left - r.left, box.top - r.top);
        const text = (el.innerText || el.tagName).trim().slice(0, 60);
        if (past > 0.5) problems.push({ order, kind: "clipped", text, px: Math.round(past * 10) / 10 });
        const style = getComputedStyle(el);
        const hides = style.overflow !== "visible" || style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none";
        const hidden = Math.max(el.scrollWidth - el.clientWidth, el.scrollHeight - el.clientHeight);
        if (hides && hidden > 1 && el !== label && el.innerText) problems.push({ order, kind: "cut-short", text, px: hidden });
      });
    });
    return problems;
  });
}

/** Picks a template, waits for the capture, and runs every check on it. Returns the DOM problems found. */
async function checkTemplate(page: Page, template: (typeof LABEL_TEMPLATES)[number], runName: string): Promise<LabelProblem[]> {
    await page.getByLabel("Label template").selectOption(template.id);
    const download = page.getByRole("button", { name: "Download PDF" });
    await expect(download).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator("[data-testid=print-preview] img").first()).toBeVisible();

    const problems = await findProblems(page);

    // The captured images themselves, for review.
    const dir = path.join(outDir, runName, template.id);
    mkdirSync(dir, { recursive: true });
    const images = new Map<string, string>();
    for (;;) {
      for (const [id, src] of await page.locator("[data-testid=print-preview] img[data-order-id]").evaluateAll((els) => els.map((el) => [el.getAttribute("data-order-id")!, (el as HTMLImageElement).src] as const)))
        images.set(id, src);
      const next = page.getByRole("button", { name: "Next page" });
      if (await next.isDisabled()) break;
      await next.click();
    }
    for (const [id, dataUrl] of images) {
      const ext = dataUrl.startsWith("data:image/png") ? "png" : "jpg";
      writeFileSync(path.join(dir, `${id.replace("label-fixture-", "")}.${ext}`), Buffer.from(dataUrl.split(",")[1]!, "base64"));
    }
    expect(images.size, `${template.id} captured every order`).toBe(orders.length);

    // Fidelity: the image must lay out like the DOM the fit was measured on. Where the text ends on the label (DOM)
    // and where the ink ends in the captured image must agree — a font that differs between the two (fallback vs
    // embedded) re-wraps lines and moves that point, which is exactly how text ends up cut on paper.
    const drift = await page.evaluate(async (entries) => {
      const out: Array<{ order: string; dom: number; ink: number }> = [];
      for (const [orderNumber, src] of entries) {
        const label = document.querySelector<HTMLElement>(`[data-testid=label-capture-host] [data-label-order="${orderNumber}"]`);
        if (!label) continue;
        const box = label.getBoundingClientRect();
        let bottom = 0;
        label.querySelectorAll<HTMLElement | SVGElement>("p, span, dd, dt, li, svg").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.height > 0 && (el.tagName.toLowerCase() === "svg" || (el.textContent ?? "").trim())) bottom = Math.max(bottom, r.bottom - box.top);
        });
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let inkRow = 0;
        for (let y = canvas.height - 1; y >= 0 && !inkRow; y--) {
          for (let x = 0; x < canvas.width; x += 2) {
            if (data[(y * canvas.width + x) * 4]! < 110) {
              inkRow = y + 1;
              break;
            }
          }
        }
        out.push({ order: orderNumber, dom: bottom / box.height, ink: inkRow / canvas.height });
      }
      return out;
    }, [...images].map(([id, src]) => [orders.find((o) => o.id === id)!.orderNumber, src] as const));
    for (const d of drift) {
      expect(Math.abs(d.dom - d.ink), `${template.id} ${d.order}: text ends at ${(d.dom * 100).toFixed(1)}% in the DOM but ${(d.ink * 100).toFixed(1)}% in the image`).toBeLessThan(0.025);
    }

    // Layout fidelity: the browser's own rendering of each label (a screenshot of the DOM node, brought on screen) vs the
    // captured image, at the same size. The DOM is what the fit engine measured, so its lines must be where the
    // printed lines are — see the row-profile comment below.
    const onScreen = geometryFits(template);
    for (const [id, src] of onScreen ? images : []) {
      const order = orders.find((o) => o.id === id)!;
      // One label at a time at the top-left corner, so it is fully inside the viewport for the screenshot.
      await page.evaluate((orderNumber) => {
        const host = document.querySelector<HTMLElement>("[data-testid=label-capture-host]")!;
        Object.assign(host.style, { left: "0px", top: "0px", zIndex: "2147483647" });
        host.querySelectorAll<HTMLElement>("[data-label-order]").forEach((el) => (el.style.display = el.dataset.labelOrder === orderNumber ? "" : "none"));
      }, order.orderNumber);
      const shot = (await page.locator(`[data-testid=label-capture-host] [data-label-order="${order.orderNumber}"]`).screenshot()).toString("base64");
      const { mismatch, diff } = await page.evaluate(
        async ({ shot, src }) => {
          const load = async (url: string) => {
            const img = new Image();
            img.src = url;
            await img.decode();
            return img;
          };
          const [a, b] = await Promise.all([load(`data:image/png;base64,${shot}`), load(src)]);
          const w = a.naturalWidth;
          const h = a.naturalHeight;
          const bits = (img: HTMLImageElement) => {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d")!;
            ctx.drawImage(img, 0, 0, w, h);
            const d = ctx.getImageData(0, 0, w, h).data;
            const out = new Uint8Array(w * h);
            for (let i = 0; i < w * h; i++) out[i] = d[i * 4]! < 150 ? 1 : 0;
            return out;
          };
          const pa = bits(a);
          const pb = bits(b);
          // Row profile: does this pixel row carry ink? Text lines are bands of inked rows, so a line that wraps
          // differently (an extra or missing line, or the lines after it moved) shows up as bands that don't line
          // up. Horizontal drift inside a line — the capture's text runs a little narrower than on screen — leaves
          // the bands where they are, and can only ever mean fewer lines in print, never more.
          // A row counts as ink only past a small density: the anti-aliased fringe at the top and bottom of a line
          // differs between two rasterizers (and between Windows and Linux) by a pixel or two, while a real text line
          // is dense — so the fringe stops counting as drift and a moved or extra line still does.
          const minInk = Math.max(2, Math.round(w * 0.004));
          const rows = (px: Uint8Array) => Array.from({ length: h }, (_, y) => {
            let n = 0;
            for (let x = 0; x < w; x++) n += px[y * w + x]!;
            return n > minInk;
          });
          const ra = rows(pa);
          const rb = rows(pb);
          const slack = Math.max(2, Math.round(h * 0.004));
          const near = (r: boolean[], y: number, v: boolean) => {
            for (let d = -slack; d <= slack; d++) if (r[y + d] === v) return true;
            return false;
          };
          let missed = 0;
          for (let y = 0; y < h; y++) if (!near(rb, y, ra[y]!) || !near(ra, y, rb[y]!)) missed++;
          // A diff picture for the failure report: red = only on screen, blue = only in the captured image.
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d")!;
          const out = ctx.createImageData(w, h);
          for (let i = 0; i < w * h; i++) {
            const rgb = pa[i] && pb[i] ? [0, 0, 0] : pa[i] ? [230, 0, 0] : pb[i] ? [0, 90, 255] : [255, 255, 255];
            out.data.set([...rgb, 255], i * 4);
          }
          ctx.putImageData(out, 0, 0);
          return { mismatch: missed / h, diff: c.toDataURL("image/png") };
        },
        { shot, src },
      );
      console.log(`line drift ${template.id} ${order.orderNumber}: ${(mismatch * 100).toFixed(2)}%`);
      if (mismatch >= MAX_LINE_DRIFT) {
        // Into the HTML report (CI keeps it as an artifact), so a failure there can be seen, not guessed at.
        await test.info().attach(`line drift ${template.id} ${order.orderNumber}`, { body: Buffer.from(diff.split(",")[1]!, "base64"), contentType: "image/png" });
      }
      expect(mismatch, `${template.id} ${order.orderNumber}: printed lines sit differently from the on-screen label in ${(mismatch * 100).toFixed(1)}% of rows`).toBeLessThan(MAX_LINE_DRIFT);
    }
    await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>("[data-testid=label-capture-host]")!;
      host.style.left = "-99999px";
      host.querySelectorAll<HTMLElement>("[data-label-order]").forEach((el) => (el.style.display = ""));
    });

    // The page's own fit report: every one of these orders fits this size.
    await expect(page.getByTestId("label-fit-report")).toBeVisible();
    await expect(page.getByTestId("label-fit-report")).not.toContainText("too long");

    // The PDF: page count and every page's MediaBox at the template's exact size.
    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    const pdf = readFileSync((await file.path())!).toString("latin1");
    const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [Number(m[3]), Number(m[4])]);
    const perPage = template.columns * template.rows;
    expect(boxes.length, `${template.id} page count`).toBe(Math.ceil(orders.length / perPage));
    const pt = (mm: number) => (mm * 72) / 25.4;
    for (const [w, h] of boxes) {
      const portrait = [pt(template.pageWmm), pt(template.pageHmm)];
      const fits = (a: number[], b: number[]) => Math.abs(a[0]! - b[0]!) < 0.6 && Math.abs(a[1]! - b[1]!) < 0.6;
      expect(fits([w!, h!], portrait) || fits([w!, h!], [portrait[1]!, portrait[0]!]), `${template.id} page size ${w}×${h}pt`).toBe(true);
    }

  return problems;
}

test.describe("shipping label printing", () => {
  // The capture host lays labels out at 8× (LABEL_RENDER_SCALE), so a plain 1× screenshot already compares at the
  // capture's detail. The viewport holds every label up to an A4 4-up cell at 8× (the 1-up and 2-up cells are too big
  // to screenshot; they render through the same component and are covered by every other check).
  test.use({ deviceScaleFactor: 1, viewport: VIEWPORT });

  /** Opens the print page on the fixture orders. `logo`: the store's settings point at a served test logo; otherwise
   * the store has none and the header falls back to the wordmark. */
  async function openPrintPage(page: Page, { logo }: { logo: boolean }) {
    await page.route("**/api/orders/bulk/get", (route) => route.fulfill({ json: { orders } }));
    await page.route(LOGO_URL, (route) => route.fulfill({ body: makeLogoPng(), contentType: "image/png" }));
    await page.route("**/api/settings", async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as { settings: Record<string, unknown> };
      json.settings.logoUrl = logo ? LOGO_URL : null;
      await route.fulfill({ response, json });
    });
    await login(page);
    await page.evaluate((ids) => sessionStorage.setItem("print-label-order-ids", JSON.stringify(ids)), orders.map((o) => o.id));
    await page.goto("/admin/orders/print-labels");
    await expect(page.getByText(orders[0]!.orderNumber).first()).toBeVisible({ timeout: 30_000 });
  }

  function expectNoProblems(report: Record<string, LabelProblem[]>) {
    const failing = Object.entries(report).filter(([, problems]) => problems.length > 0);
    expect(failing.map(([id, problems]) => `${id}: ${problems.map((p) => `${p.order} ${p.kind} "${p.text}"`).join("; ")}`)).toEqual([]);
  }

  test("every template prints every hard order without cutting text", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "label capture is the same on every viewport");
    test.setTimeout(300_000);
    await openPrintPage(page, { logo: true });

    const report: Record<string, LabelProblem[]> = {};
    for (const template of LABEL_TEMPLATES) report[template.id] = await checkTemplate(page, template, "logo");

    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    expectNoProblems(report);
  });

  test("a store without a logo, and a non-thermal printer, print just as whole", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "label capture is the same on every viewport");
    test.setTimeout(180_000);
    await openPrintPage(page, { logo: false });
    const picks = LABEL_TEMPLATES.filter((t) => ["sticker-51x76", "sticker-50x30", "a4-6up"].includes(t.id));

    const report: Record<string, LabelProblem[]> = {};
    for (const template of picks) report[template.id] = await checkTemplate(page, template, "no-logo");

    // Thermal off: a sticker template then captures colour JPEG instead of the thresholded PNG.
    await page.getByLabel("Label template").selectOption("sticker-51x76");
    await page.getByLabel("Thermal printer").uncheck();
    const preview = page.locator("[data-testid=print-preview] img[data-order-id]").first();
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeEnabled({ timeout: 60_000 });
    await expect.poll(async () => (await preview.getAttribute("src"))?.slice(0, 15), { timeout: 30_000 }).toBe("data:image/jpeg");
    report["sticker-51x76 (inkjet)"] = await checkTemplate(page, LABEL_TEMPLATES.find((t) => t.id === "sticker-51x76")!, "inkjet");
    await page.getByLabel("Thermal printer").check();

    expectNoProblems(report);
  });
});
