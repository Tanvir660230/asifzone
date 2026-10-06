"""Nasihamart brand assets as true vector SVG: the mark is geometry, every letter is an outlined glyph (kerned by
HarfBuzz) — no font dependency anywhere the files are used. Fonts: Newsreader and Instrument Sans (SIL OFL 1.1).
Usage (from this folder): python build.py ..
Needs `pip install fonttools uharfbuzz` and the two variable fonts in ./fonts (not committed):
  https://github.com/google/fonts/raw/main/ofl/newsreader/Newsreader%5Bopsz,wght%5D.ttf        → fonts/Newsreader.ttf
  https://github.com/google/fonts/raw/main/ofl/instrumentsans/InstrumentSans%5Bwdth,wght%5D.ttf → fonts/InstrumentSans.ttf
PNG exports (../png) are rendered from the SVGs with sharp; see ../README.md.
"""
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = Path(__file__).parent
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)

NAVY, STONE, IVORY, WHITE = "#0B1F33", "#D6C1A2", "#F8F6F1", "#FFFFFF"


def text_path(font_file, axes, text, size, tracking=0.0, x0=0.0, baseline=0.0):
    """SVG path data for `text` at font `size` (px), its left edge at x0 and baseline at `baseline`. Returns (d, width)."""
    data = (HERE / "fonts" / font_file).read_bytes()
    face = hb.Face(data)
    font = hb.Font(face)
    font.set_variations(axes)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": False})
    tt = instantiateVariableFont(TTFont(HERE / "fonts" / font_file), axes)
    glyphs = tt.getGlyphSet()
    order = tt.getGlyphOrder()
    upm = tt["head"].unitsPerEm
    s = size / upm
    pen = SVGPathPen(glyphs)
    x = 0.0
    n = len(buf.glyph_infos)
    for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        name = order[info.codepoint]
        # Font units are y-up; SVG is y-down — scale, flip, and place on the baseline.
        tp = TransformPen(pen, (s, 0, 0, -s, x0 + (x + pos.x_offset) * s, baseline - pos.y_offset * s))
        glyphs[name].draw(tp)
        x += pos.x_advance + (tracking * upm if i < n - 1 else 0)
    return pen.getCommands(), x * s


# ── The mark, on a 64-unit square ─────────────────────────────────────────────────────────────────────────
# A pointed (two-centred) arch — the doorway / mihrab outline of Islamic architecture, drawn as a single open stroke —
# framing a geometric N. Nothing else: no star, no cart, no ornament.
ARCH = "M12 60V30C12 18.5 21 10.5 32 4C43 10.5 52 18.5 52 30V60"
# The N is the wordmark's own letter (Newsreader, heavier), centred under the arch — mark and name are one typeface.
_n_probe, _n_w = text_path("Newsreader.ttf", {"wght": 640, "opsz": 72}, "N", 42)
N, _ = text_path("Newsreader.ttf", {"wght": 640, "opsz": 72}, "N", 42, x0=32 - _n_w / 2, baseline=58)


def mark(arch_color, n_color, stroke=3.2):
    return (f'<path d="{ARCH}" fill="none" stroke="{arch_color}" stroke-width="{stroke}" stroke-linejoin="miter"/>'
            f'<path d="{N}" fill="{n_color}"/>')


def svg(width, height, body, title, bg=None):
    rect = f'<rect width="{width}" height="{height}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:g} {height:g}" width="{width:g}" height="{height:g}" '
            f'role="img" aria-label="{title}"><title>{title}</title>{rect}{body}</svg>\n')


# ── Wordmark: Newsreader at a display optical size, medium weight, slightly tightened ──────────────────────
WORD_AXES = {"wght": 500, "opsz": 36}
WORD_SIZE = 40  # cap height ≈ 26.8 units: the caps stand as tall as the N (y 30–58 in the mark)
GAP = 11  # from the arch's right edge (x 52)
LEFT = 10  # the arch's left edge, less its half stroke
word_d, word_w = text_path("Newsreader.ttf", WORD_AXES, "Nasihamart", WORD_SIZE, tracking=-0.006, x0=52 + GAP, baseline=58)
LOCKUP_W = round(52 + GAP + word_w + 1 - LEFT, 2)
LOCKUP_H = 64


def lockup(arch, n, word):
    return f'<g transform="translate({-LEFT} 0)">' + mark(arch, n) + f'<path d="{word_d}" fill="{word}"/></g>'


files = {
    # 1. Primary full logo — light backgrounds: navy N and wordmark, warm-stone arch.
    "nasihamart-logo.svg": svg(LOCKUP_W, LOCKUP_H, lockup(STONE, NAVY, NAVY), "Nasihamart"),
    # 2. For navy / dark backgrounds: ivory N and wordmark, warm-stone arch.
    "nasihamart-logo-on-dark.svg": svg(LOCKUP_W, LOCKUP_H, lockup(STONE, IVORY, IVORY), "Nasihamart"),
    # 3. Icon only.
    "nasihamart-icon.svg": svg(64, 64, mark(STONE, NAVY), "Nasihamart"),
    # 5–6. Monochrome.
    "nasihamart-logo-black.svg": svg(LOCKUP_W, LOCKUP_H, lockup("#000000", "#000000", "#000000"), "Nasihamart"),
    "nasihamart-logo-white.svg": svg(LOCKUP_W, LOCKUP_H, lockup(WHITE, WHITE, WHITE), "Nasihamart"),
    "nasihamart-icon-black.svg": svg(64, 64, mark("#000000", "#000000"), "Nasihamart"),
    "nasihamart-icon-white.svg": svg(64, 64, mark(WHITE, WHITE), "Nasihamart"),
}

# 4. Favicon: a navy tile so the mark holds at 16px — a heavier arch, ivory N, the mark scaled into the tile.
fav_body = (f'<rect width="64" height="64" rx="12" fill="{NAVY}"/>'
            f'<g transform="translate(32 33.5) scale(0.82) translate(-32 -32)">{mark(STONE, IVORY, stroke=4.6)}</g>')
files["nasihamart-favicon.svg"] = svg(64, 64, fav_body, "Nasihamart")

# Social / Open Graph image, 1200×630: ivory, a hairline stone frame, the logo, a stone rule, the descriptor.
W, H = 1200, 630
scale = 560 / LOCKUP_W
lx, ly = (W - 560) / 2, 214
desc_d, desc_w = text_path("InstrumentSans.ttf", {"wght": 560, "wdth": 100}, "PREMIUM ISLAMIC LIFESTYLE MARKETPLACE", 19, tracking=0.2, x0=0, baseline=0)
og_body = (
    f'<rect x="28" y="28" width="{W - 56}" height="{H - 56}" fill="none" stroke="{STONE}" stroke-width="1.5"/>'
    f'<g transform="translate({lx:.2f} {ly}) scale({scale:.5f})">{lockup(STONE, NAVY, NAVY)}</g>'
    f'<rect x="{W / 2 - 28}" y="{ly + 64 * scale + 46:.2f}" width="56" height="1.5" fill="{STONE}"/>'
    f'<path d="{desc_d}" fill="{NAVY}" transform="translate({(W - desc_w) / 2:.2f} {ly + 64 * scale + 98:.2f})"/>'
)
files["nasihamart-og-image.svg"] = svg(W, H, og_body, "Nasihamart — Premium Islamic Lifestyle Marketplace", bg=IVORY)

for name, content in files.items():
    (OUT / name).write_text(content, encoding="utf8")
    print(f"{name}  {len(content) // 1024}KB")
print(f"lockup {LOCKUP_W}x{LOCKUP_H}")
