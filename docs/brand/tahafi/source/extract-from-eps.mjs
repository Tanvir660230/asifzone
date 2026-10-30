// Pulls the logo's vector outlines out of the designer's master file (Illustrator EPS, "Printable File.eps" — a 5 × 4
// sheet of every lockup on every ground) into logo-paths.json, which build.mjs draws every brand file from. Run it again
// only when the designer sends a new master:
//   node docs/brand/tahafi/source/extract-from-eps.mjs "<path to Printable File.eps>"
// The EPS draws with Illustrator's AGM operators (mo/li/cv/cp, filled with f); the page transform flips y, so its
// coordinates already read top-down like SVG.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const lines = readFileSync(process.argv[2], "latin1").split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith("%%EndPageSetup"));

const num = (value) => String(+(+value).toFixed(2));
const shapes = [];
let d = "";
for (const line of lines.slice(start)) {
  if (line.startsWith("%%PageTrailer")) break;
  const t = line.trim().split(/\s+/);
  const op = t[t.length - 1];
  if (op === "mo") d += `M${num(t[0])} ${num(t[1])}`;
  else if (op === "li") d += `L${num(t[0])} ${num(t[1])}`;
  else if (op === "cv") d += `C${t.slice(0, 6).map(num).join(" ")}`;
  else if (op === "cp") d += d ? "Z" : "";
  else if (op === "f") {
    if (d) shapes.push(d);
    d = "";
  } else if (op === "np" || op === "clp") d = "";
}

// Bounding box from the points (control points included: a hair generous, never clipping).
const box = (path) => {
  const n = path.match(/-?[\d.]+/g).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const all = shapes.map((path) => ({ path, box: box(path) }));

// The sheet's third column is the olive-on-cream row: stacked lockup, horizontal lockup, mark. Backgrounds are tile-sized.
const TILE = 5246 / 5;
const tile = (col, row) =>
  all
    .filter(({ box: [x1, y1, x2, y2] }) => x1 >= col * TILE - 5 && x2 <= (col + 1) * TILE + 5 && y1 >= row * TILE - 5 && y2 <= (row + 1) * TILE + 5)
    .filter(({ box: [x1, , x2] }) => x2 - x1 < 800);

const translate = (path, dx, dy) =>
  path.replace(/([MLC])([^MLCZ]*)/g, (_, op, args) => op + args.trim().split(/\s+/).map((v, i) => num(+v - (i % 2 ? dy : dx))).join(" "));

/** The shapes moved to the origin, as one path with its size. */
function art(parts) {
  const x1 = Math.min(...parts.map((p) => p.box[0]));
  const y1 = Math.min(...parts.map((p) => p.box[1]));
  const x2 = Math.max(...parts.map((p) => p.box[2]));
  const y2 = Math.max(...parts.map((p) => p.box[3]));
  return { width: +(x2 - x1).toFixed(2), height: +(y2 - y1).toFixed(2), d: parts.map((p) => translate(p.path, x1, y1)).join("") };
}

const horizontal = tile(2, 1).sort((a, b) => a.box[0] - b.box[0]);
// In the horizontal lockup the mark is the leftmost cluster, the wordmark starts after the first gap.
const markRight = Math.max(...horizontal.slice(0, 5).map((p) => p.box[2]));
const out = {
  source: "Printable File.eps (Adobe Illustrator 30.8, 2026-10-28)",
  stacked: art(tile(2, 0)),
  horizontal: art(horizontal),
  mark: art(tile(2, 2)),
  wordmark: art(horizontal.filter((p) => p.box[0] > markRight)),
};
writeFileSync(path.join(here, "logo-paths.json"), JSON.stringify(out, null, 2) + "\n");
console.log(Object.entries(out).map(([k, v]) => (typeof v === "string" ? v : `${k} ${v.width}×${v.height}`)).join("\n"));
