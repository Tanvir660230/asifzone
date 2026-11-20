"use client";

import JsBarcode from "jsbarcode";
import { QRCodeDecoderErrorCorrectionLevel, QRCodeEncoder } from "@zxing/library";
import { runs, stickerGeometry, stickerTitle, type StickerDpi } from "./sticker-layout";

/**
 * Draws a product sticker into a bitmap of exactly one pixel per printer dot (sticker-layout.ts), pure black and white.
 * Text, frame and logo are drawn, then thresholded; the Code 128 bars and QR squares are drawn last as whole-dot
 * rectangles on cleared quiet zones, so they are exactly what the encoders produced — never resampled or anti-aliased.
 */

export interface StickerContent {
  productName: string;
  labelName: string | null;
  labelTag: string | null;
  size: string;
  color: string;
  /** What the scanner reads: the variant's barcode, else its SKU. Both codes carry it. */
  code: string;
}

export interface StickerBrand {
  logo: HTMLImageElement | null;
  storeName: string;
  tagline: string | null;
}

export interface RenderedSticker {
  /** PNG data URL, W × H pixels = printer dots. */
  url: string;
  width: number;
  height: number;
}

export function code128Bits(value: string): string {
  const o: { encodings?: Array<{ data: string }> } = {};
  JsBarcode(o, value, { format: "CODE128" });
  return (o.encodings ?? []).map((e) => e.data).join("");
}

export function qrMatrix(value: string): boolean[][] {
  const m = QRCodeEncoder.encode(value, QRCodeDecoderErrorCorrectionLevel.M, new Map()).getMatrix();
  const n = m.getWidth();
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => m.get(x, y) === 1));
}

/** The admin's sans font (Inter via next/font), loaded at the weights the sticker uses. */
export async function stickerFont(): Promise<string> {
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "Inter, system-ui, sans-serif";
  await Promise.all(["600", "700", "800"].map((w) => document.fonts.load(`${w} 24px ${family}`).catch(() => [])));
  return family;
}

export function loadLogo(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Largest font size ≤ `size` at which `text` fits `maxW` (letter spacing included). */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, family: string, maxW: number, spacing = 0): number {
  let s = size;
  for (;;) {
    ctx.font = `${weight} ${s}px ${family}`;
    ctx.letterSpacing = `${spacing}px`;
    if (ctx.measureText(text).width <= maxW || s <= 6) return s;
    s -= 0.5;
  }
}

export function renderSticker(content: StickerContent, brand: StickerBrand, dpi: StickerDpi, family: string): RenderedSticker {
  const bits = code128Bits(content.code);
  const qr = qrMatrix(content.code);
  const g = stickerGeometry(dpi, bits.length, qr.length);
  const canvas = document.createElement("canvas");
  canvas.width = g.W;
  canvas.height = g.H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, g.W, g.H);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "middle";
  const D = (mm: number) => Math.round(mm * (g.W / 50));

  // Frame.
  ctx.lineWidth = g.frame.width;
  roundRect(ctx, g.frame.inset + g.frame.width / 2, g.frame.inset + g.frame.width / 2, g.W - 2 * g.frame.inset - g.frame.width, g.H - 2 * g.frame.inset - g.frame.width, g.frame.radius);
  ctx.stroke();

  // Logo (or the store name), separator, tagline.
  let logoRight = g.logo.x;
  let logoBox: [number, number, number, number] | null = null;
  if (brand.logo && brand.logo.naturalWidth > 0) {
    const w = Math.round((g.logo.h * brand.logo.naturalWidth) / brand.logo.naturalHeight);
    const maxW = g.leftW * 0.55;
    const lw = Math.min(w, Math.round(maxW));
    const lh = Math.round((lw * brand.logo.naturalHeight) / brand.logo.naturalWidth);
    const ly = g.logo.y + Math.round((g.logo.h - lh) / 2);
    ctx.drawImage(brand.logo, g.logo.x, ly, lw, lh);
    logoBox = [g.logo.x, ly, lw, lh];
    logoRight = g.logo.x + lw;
  } else {
    const s = fit(ctx, brand.storeName, 800, D(2.4), family, g.leftW * 0.55);
    ctx.font = `800 ${s}px ${family}`;
    ctx.letterSpacing = "0px";
    ctx.textAlign = "left";
    ctx.fillText(brand.storeName, g.logo.x, g.logo.y + g.logo.h / 2);
    logoRight = g.logo.x + Math.ceil(ctx.measureText(brand.storeName).width);
  }
  if (brand.tagline?.trim()) {
    const sepX = logoRight + D(1);
    ctx.fillRect(sepX, g.logo.y + D(0.15), g.line, g.logo.h - D(0.3));
    const tx = sepX + g.line + D(1);
    const t = brand.tagline.trim().toUpperCase();
    const s = fit(ctx, t, 600, g.font.tagline, family, g.col - D(1.25) - tx, D(0.27));
    ctx.font = `600 ${s}px ${family}`;
    ctx.letterSpacing = `${D(0.27)}px`;
    ctx.textAlign = "left";
    ctx.fillText(t, tx, g.logo.y + g.logo.h / 2);
  }

  // Name and tag pill. Without a tag the name sits centred in the space the pill would share.
  const title = stickerTitle(content);
  const tag = content.labelTag?.trim() || null;
  const nameSize = fit(ctx, title, 800, g.name.size, family, g.leftW, -0.4);
  ctx.font = `800 ${nameSize}px ${family}`;
  ctx.letterSpacing = "-0.4px";
  ctx.textAlign = "left";
  ctx.fillText(title, g.L, tag ? g.name.y : Math.round((g.name.y + g.pill.y + g.pill.h / 2) / 2));
  if (tag) {
    const s = fit(ctx, tag, 700, g.font.tag, family, g.leftW - 2 * g.pill.pad);
    ctx.font = `700 ${s}px ${family}`;
    ctx.letterSpacing = "0px";
    const w = Math.round(ctx.measureText(tag).width + 2 * g.pill.pad);
    roundRect(ctx, g.L, g.pill.y, w, g.pill.h, g.pill.radius);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(tag, g.L + g.pill.pad, g.pill.y + g.pill.h / 2 + D(0.05));
    ctx.fillStyle = "#000";
  }

  // Column line (top half), SIZE and COLOR cells.
  ctx.fillRect(g.col, g.T, g.line, g.rule - D(1) - g.T);
  const c = g.cells;
  const cell = (y: number, label: string, value: string, dark: boolean) => {
    ctx.lineWidth = g.line;
    roundRect(ctx, c.x + g.line / 2, y + g.line / 2, c.w - g.line, c.h - g.line, c.radius);
    ctx.stroke();
    if (dark) {
      ctx.beginPath();
      ctx.roundRect(c.x + c.labelW, y, c.w - c.labelW, c.h, [0, c.radius, c.radius, 0]);
      ctx.fill();
    } else {
      ctx.fillRect(c.x + c.labelW, y, g.line, c.h);
    }
    ctx.textAlign = "center";
    ctx.font = `700 ${g.font.label}px ${family}`;
    ctx.letterSpacing = `${D(0.11)}px`;
    ctx.fillText(label, c.x + c.labelW / 2, y + c.h / 2);
    const vw = c.w - c.labelW - D(2);
    const s = fit(ctx, value, 800, dark ? g.font.size : g.font.color, family, vw);
    ctx.font = `800 ${s}px ${family}`;
    ctx.letterSpacing = "0px";
    if (dark) ctx.fillStyle = "#fff";
    ctx.fillText(value, c.x + c.labelW + (c.w - c.labelW) / 2, y + c.h / 2 + D(0.1));
    ctx.fillStyle = "#000";
  };
  cell(c.sizeY, "SIZE", content.size || "—", true);
  cell(c.colorY, "COLOR", content.color || "—", false);

  // Rule (to the column line), lower column line, the code's text.
  ctx.fillRect(g.L, g.rule, g.col + g.line - g.L, g.line);
  ctx.fillRect(g.colBottom, g.rule + D(1.25), g.line, g.B - g.rule - D(1.25));
  const cs = fit(ctx, content.code, 600, g.codeText.size, family, g.codeText.maxW, D(0.2));
  ctx.font = `600 ${cs}px ${family}`;
  ctx.letterSpacing = `${D(0.2)}px`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(content.code, g.codeText.x, g.codeText.y);

  // Black and white: 50 % grey for text and lines; inside the logo a lighter cut-off keeps thin serif strokes.
  const img = ctx.getImageData(0, 0, g.W, g.H);
  const px = img.data;
  for (let y = 0; y < g.H; y++) {
    for (let x = 0; x < g.W; x++) {
      const k = (y * g.W + x) * 4;
      const a = px[k + 3]! / 255;
      const lum = (0.3 * px[k]! + 0.59 * px[k + 1]! + 0.11 * px[k + 2]!) * a + 255 * (1 - a);
      const inLogo = logoBox && x >= logoBox[0] && x < logoBox[0] + logoBox[2] && y >= logoBox[1] && y < logoBox[1] + logoBox[3];
      const v = lum < (inLogo ? 215 : 140) ? 0 : 255;
      px[k] = px[k + 1] = px[k + 2] = v;
      px[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Codes last, as whole-dot rectangles on cleared quiet zones.
  const b = g.bars;
  ctx.fillStyle = "#fff";
  ctx.fillRect(b.x - 10 * b.module, b.y, (bits.length + 20) * b.module, b.height);
  const q = g.qr;
  const qq = 4 * q.module, qs = q.cells * q.module;
  ctx.fillRect(q.x - qq, q.y - qq, qs + 2 * qq, qs + 2 * qq);
  ctx.fillStyle = "#000";
  for (const r of runs(bits)) ctx.fillRect(b.x + r.start * b.module, b.y, r.width * b.module, b.height);
  for (let y = 0; y < q.cells; y++) for (let x = 0; x < q.cells; x++) if (qr[y]![x]) ctx.fillRect(q.x + x * q.module, q.y + y * q.module, q.module, q.module);

  return { url: canvas.toDataURL("image/png"), width: g.W, height: g.H };
}
