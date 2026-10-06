import sharp from "sharp";

/**
 * Placeholder imagery for sample stores: a calm tonal background, a simple silhouette of the product kind and a small
 * "SAMPLE IMAGE" mark, so a placeholder can never be mistaken for real photography. Rendered from SVG with sharp.
 */

export type ArtKind = "panjabi" | "kufi" | "book" | "mat" | "bottle" | "tasbih" | "vessel" | "gift";

/** Silhouettes drawn in a 1000 × 1000 box, centred. `fill` is the deeper tone, `line` a soft detail stroke. */
function silhouette(kind: ArtKind, fill: string, line: string): string {
  switch (kind) {
    case "panjabi":
      return `<path d="M410 170 L590 170 L700 230 L790 420 L720 450 L660 330 L660 860 L340 860 L340 330 L280 450 L210 420 L300 230 Z" fill="${fill}"/>
        <path d="M500 175 L500 480" stroke="${line}" stroke-width="6"/><circle cx="500" cy="260" r="7" fill="${line}"/><circle cx="500" cy="340" r="7" fill="${line}"/><circle cx="500" cy="420" r="7" fill="${line}"/>`;
    case "kufi":
      return `<path d="M260 600 C260 380 370 300 500 300 C630 300 740 380 740 600 Z" fill="${fill}"/>
        <rect x="250" y="590" width="500" height="90" rx="20" fill="${fill}"/><path d="M262 600 L738 600" stroke="${line}" stroke-width="6"/>`;
    case "book":
      return `<rect x="300" y="220" width="400" height="560" rx="18" fill="${fill}"/>
        <rect x="300" y="220" width="46" height="560" rx="12" fill="${line}" opacity="0.5"/><rect x="400" y="330" width="220" height="90" rx="8" fill="${line}" opacity="0.35"/>`;
    case "mat":
      return `<rect x="290" y="170" width="420" height="680" rx="20" fill="${fill}"/>
        <path d="M350 790 L350 380 C350 290 420 240 500 240 C580 240 650 290 650 380 L650 790 Z" fill="none" stroke="${line}" stroke-width="8"/>`;
    case "bottle":
      return `<rect x="455" y="250" width="90" height="90" rx="14" fill="${line}"/><rect x="470" y="330" width="60" height="70" fill="${fill}"/>
        <rect x="360" y="390" width="280" height="400" rx="60" fill="${fill}"/><rect x="420" y="520" width="160" height="110" rx="10" fill="${line}" opacity="0.35"/>`;
    case "tasbih": {
      const beads = Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return `<circle cx="${500 + Math.cos(a) * 230}" cy="${450 + Math.sin(a) * 230}" r="30" fill="${fill}"/>`;
      }).join("");
      return `${beads}<rect x="485" y="680" width="30" height="80" rx="10" fill="${fill}"/><path d="M470 760 L530 760 L550 880 L450 880 Z" fill="${line}"/>`;
    }
    case "vessel":
      return `<path d="M380 300 L620 300 L600 360 C700 420 720 560 680 680 C650 770 580 800 500 800 C420 800 350 770 320 680 C280 560 300 420 400 360 Z" fill="${fill}"/>
        <ellipse cx="500" cy="300" rx="120" ry="18" fill="${line}" opacity="0.5"/>`;
    case "gift":
      return `<rect x="270" y="420" width="460" height="380" rx="16" fill="${fill}"/><rect x="240" y="350" width="520" height="100" rx="16" fill="${fill}"/>
        <rect x="475" y="350" width="50" height="450" fill="${line}" opacity="0.55"/><path d="M500 350 C440 250 350 270 380 330 C400 360 470 355 500 350 C530 355 600 360 620 330 C650 270 560 250 500 350 Z" fill="${line}" opacity="0.7"/>`;
  }
}

/** A darker tone of `hex` (factor < 1) or a lighter one (factor > 1). */
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 255;
    const v = factor < 1 ? c * factor : c + (255 - c) * (factor - 1);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return `#${[16, 8, 0].map((s) => channel(s).toString(16).padStart(2, "0")).join("")}`;
}

/** A placeholder image (WebP) of `width` × `height` with the silhouette centred and scaled to fit. */
export async function renderPlaceholder(kind: ArtKind, tone: string, width: number, height: number, variant = 0): Promise<Buffer> {
  const background = variant ? shade(tone, 0.94) : tone;
  const scale = Math.min(width, height) / 1000;
  const offsetX = (width - 1000 * scale) / 2;
  const offsetY = (height - 1000 * scale) / 2 + (variant ? 30 * scale : 0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(background, 1.12)}"/><stop offset="1" stop-color="${background}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <ellipse cx="${width / 2}" cy="${offsetY + 880 * scale}" rx="${300 * scale}" ry="${26 * scale}" fill="#000" opacity="0.06"/>
    <g transform="translate(${offsetX} ${offsetY}) scale(${variant ? scale * 0.92 : scale})">${silhouette(kind, shade(tone, 0.72), shade(tone, 0.55))}</g>
    <text x="${width / 2}" y="${height - Math.max(28, height * 0.04)}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.max(14, Math.round(Math.min(width, height) * 0.022))}" letter-spacing="4" fill="${shade(tone, 0.5)}" opacity="0.75">SAMPLE IMAGE</text>
  </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 88 }).toBuffer();
}
