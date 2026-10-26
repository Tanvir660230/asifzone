// Tahafi brand assets as true vector SVG — every letter an outlined glyph, so no file depends on a font being installed —
// plus the PNG exports the admin uploads. Fonts: Instrument Serif and Geist (SIL OFL 1.1), not committed:
//   https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf → fonts/InstrumentSerif-Regular.ttf
//   https://github.com/google/fonts/raw/main/ofl/geist/Geist%5Bwght%5D.ttf                     → fonts/Geist.ttf
// Usage (from the repo root, with opentype.js@1.3.4 installed anywhere):
//   OPENTYPE=<path to opentype.js package> FONTS=<fonts dir> node docs/brand/tahafi/source/build.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..");
const opentype = require(process.env.OPENTYPE ?? "opentype.js");
const sharp = require(path.resolve(here, "../../../../apps/api/node_modules/sharp"));
const fonts = process.env.FONTS ?? path.join(here, "fonts");
const serif = opentype.loadSync(path.join(fonts, "InstrumentSerif-Regular.ttf"));
const sans = opentype.loadSync(path.join(fonts, "Geist.ttf"));

const INK = "#1E211B";
const OLIVE = "#3E4A33";
const CREAM = "#F4F0E8";
const SAND = "#C8B89A";
const BRASS = "#A8843C";

/** Path data and bounding box of `text`, its baseline at (x, y). */
function glyphs(font, text, size, x = 0, y = 0, tracking = 0) {
  const p = font.getPath(text, x, y, size, { kerning: true, letterSpacing: tracking });
  const box = p.getBoundingBox();
  return { d: p.toPathData(2), box };
}

/** The hang-tag silhouette: both top corners cut by `cut`, a punched hole centred near the top. */
function tag(x, y, w, h, cut, hole) {
  const outline = `M${x + cut} ${y}H${x + w - cut}L${x + w} ${y + cut}V${y + h}H${x}V${y + cut}Z`;
  const cx = x + w / 2;
  const cy = y + cut * 0.95;
  const circle = `M${cx - hole} ${cy}a${hole} ${hole} 0 1 0 ${hole * 2} 0a${hole} ${hole} 0 1 0 ${-hole * 2} 0Z`;
  return `${outline}${circle}`;
}

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;
}

function wordmark(fill) {
  const { d, box } = glyphs(serif, "Tahafi", 160, 0, 0);
  const pad = 8;
  const w = Math.ceil(box.x2 - box.x1 + pad * 2);
  const h = Math.ceil(box.y2 - box.y1 + pad * 2);
  return svg(w, h, `<path fill="${fill}" transform="translate(${pad - box.x1} ${pad - box.y1})" d="${d}"/>`);
}

function icon(ground, letter) {
  const size = 512;
  const t = glyphs(serif, "T", 300, 0, 0);
  const tw = t.box.x2 - t.box.x1;
  const th = t.box.y2 - t.box.y1;
  const tx = (size - tw) / 2 - t.box.x1;
  const ty = 190 + (size - 190 - 30 - th) / 2 - t.box.y1;
  return svg(size, size, `<path fill="${ground}" fill-rule="evenodd" d="${tag(56, 16, 400, 480, 84, 26)}"/><path fill="${letter}" transform="translate(${tx} ${ty})" d="${t.d}"/>`);
}

function socialImage() {
  const w = 1200;
  const h = 630;
  const mark = glyphs(serif, "Tahafi", 220, 96, 360);
  const line = glyphs(sans, "Modern modest menswear", 38, 100, 440);
  const tagX = 880;
  return svg(
    w,
    h,
    `<rect width="${w}" height="${h}" fill="${OLIVE}"/>` +
      `<path fill="${CREAM}" d="${mark.d}"/><path fill="${SAND}" d="${line.d}"/>` +
      `<rect x="${tagX + 89}" y="0" width="2" height="170" fill="${BRASS}"/>` +
      `<g transform="rotate(5 ${tagX + 90} 170)"><path fill="${CREAM}" fill-rule="evenodd" d="${tag(tagX, 160, 180, 240, 26, 9)}"/>` +
      `<path fill="${INK}" transform="translate(${tagX + 52} 330)" d="${glyphs(serif, "T", 150, 0, 0).d}"/></g>`,
  );
}

const files = {
  "tahafi-logo.svg": wordmark(INK),
  "tahafi-logo-on-dark.svg": wordmark(CREAM),
  "tahafi-icon.svg": icon(OLIVE, CREAM),
  "tahafi-favicon.svg": icon(OLIVE, CREAM),
  "tahafi-og-image.svg": socialImage(),
};
for (const [name, body] of Object.entries(files)) writeFileSync(path.join(out, name), body);

mkdirSync(path.join(out, "png"), { recursive: true });
const png = (name, file, width) => sharp(Buffer.from(files[name])).resize({ width }).png().toFile(path.join(out, "png", file));
await png("tahafi-logo.svg", "tahafi-logo.png", 800);
await png("tahafi-logo-on-dark.svg", "tahafi-logo-on-dark.png", 800);
await png("tahafi-favicon.svg", "tahafi-favicon-512.png", 512);
await png("tahafi-favicon.svg", "tahafi-favicon-32.png", 32);
await png("tahafi-og-image.svg", "tahafi-og-image-1200x630.png", 1200);
console.log("tahafi brand assets written to", out);
