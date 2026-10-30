// Tahafi brand files, drawn from the designer's own outlines (logo-paths.json, cut from the master EPS by
// extract-from-eps.mjs) in the logo colours — nothing redrawn, no font needed. Plus the PNG exports the admin uploads.
// Usage, from the repo root: node docs/brand/tahafi/source/build.mjs
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..");
const sharp = require(path.resolve(here, "../../../../apps/api/node_modules/sharp"));
const logo = JSON.parse(readFileSync(path.join(here, "logo-paths.json"), "utf8"));

// The designer's colour sheet (RGB values).
const OLIVE = "#4F5343";
const CREAM = "#F2EFEA";
const INK = "#1C1C1A";

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;

/** One piece of art in `fill`, on a transparent ground at its own size. */
const lockup = ({ width, height, d }, fill) => svg(width, height, `<path fill="${fill}" d="${d}"/>`);

/** `art` scaled to `size` (its longer side) and centred at (cx, cy). */
function place(art, size, cx, cy, fill) {
  const scale = size / Math.max(art.width, art.height);
  const x = cx - (art.width * scale) / 2;
  const y = cy - (art.height * scale) / 2;
  return `<path fill="${fill}" transform="translate(${+x.toFixed(2)} ${+y.toFixed(2)}) scale(${+scale.toFixed(5)})" d="${art.d}"/>`;
}

/** App icon / favicon: the mark on an olive tile, as on the designer's sheet. */
const icon = (radius) => svg(512, 512, `<rect width="512" height="512" rx="${radius}" fill="${OLIVE}"/>${place(logo.mark, 300, 256, 256, CREAM)}`);

/** A portrait card for the brand story and social posts: the stacked lockup in cream, low on the olive field. */
const brandCard = () => svg(1200, 1500, `<rect width="1200" height="1500" fill="${OLIVE}"/>${place(logo.stacked, 560, 600, 750, CREAM)}`);

/** Link previews: the stacked lockup in cream on the olive field. */
const socialImage = () => svg(1200, 630, `<rect width="1200" height="630" fill="${OLIVE}"/>${place(logo.stacked, 400, 600, 315, CREAM)}`);

const files = {
  "tahafi-logo.svg": lockup(logo.horizontal, OLIVE),
  "tahafi-logo-ink.svg": lockup(logo.horizontal, INK),
  "tahafi-logo-on-dark.svg": lockup(logo.horizontal, CREAM),
  "tahafi-logo-stacked.svg": lockup(logo.stacked, OLIVE),
  "tahafi-logo-stacked-on-dark.svg": lockup(logo.stacked, CREAM),
  "tahafi-mark.svg": lockup(logo.mark, OLIVE),
  "tahafi-icon.svg": icon(112),
  "tahafi-favicon.svg": icon(96),
  "tahafi-og-image.svg": socialImage(),
  "tahafi-brand-card.svg": brandCard(),
};
for (const [name, body] of Object.entries(files)) writeFileSync(path.join(out, name), body);

mkdirSync(path.join(out, "png"), { recursive: true });
const png = (name, file, width) =>
  sharp(Buffer.from(files[name]), { density: 300 }).resize({ width }).png().toFile(path.join(out, "png", file));
await png("tahafi-logo.svg", "tahafi-logo.png", 800);
await png("tahafi-logo-on-dark.svg", "tahafi-logo-on-dark.png", 800);
await png("tahafi-logo-stacked.svg", "tahafi-logo-stacked.png", 800);
await png("tahafi-logo-stacked-on-dark.svg", "tahafi-logo-stacked-on-dark.png", 800);
await png("tahafi-favicon.svg", "tahafi-favicon-512.png", 512);
await png("tahafi-favicon.svg", "tahafi-favicon-32.png", 32);
await png("tahafi-og-image.svg", "tahafi-og-image-1200x630.png", 1200);
await png("tahafi-brand-card.svg", "tahafi-brand-card-1200x1500.png", 1200);
console.log("tahafi brand files written to", out);
