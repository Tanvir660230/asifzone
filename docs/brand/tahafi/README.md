# Tahafi brand files

Every logo file is drawn from the designer's own outlines (master: `Printable File.eps`, Illustrator, 2026-10-28), in the logo's four colours: olive `#4F5343`, sage `#84857E`, cream `#F2EFEA`, ink `#1C1C1A`.

| File | Use | Upload in |
|---|---|---|
| `png/tahafi-logo.png` | horizontal logo (mark + wordmark), olive | Admin → Settings → Store & branding → Logo |
| `png/tahafi-logo-on-dark.png` | horizontal logo, cream | → Logo on dark backgrounds |
| `png/tahafi-favicon-512.png` (`-32.png`) | the mark on an olive tile | → Favicon |
| `png/tahafi-og-image-1200x630.png` | stacked logo on olive, for link previews | → Social image |
| `png/tahafi-logo-stacked.png` (`-on-dark.png`) | stacked logo (mark over wordmark) | print, social posts |
| `png/tahafi-brand-card-1200x1500.png` | stacked logo on olive, portrait | Homepage → Brand story photo until there is a shoot; social posts |
| `*.svg` | vector masters (also `tahafi-logo-ink.svg`, `tahafi-mark.svg`, `tahafi-icon.svg`) | print, signage, packaging |
| `sample/*.jpg` | sample-store photos, cut from the owner's first AI design board | local preview only — replace with a real shoot |

Regenerate everything with `node docs/brand/tahafi/source/build.mjs` (from the repo root; needs only `pnpm install`). It reads `source/logo-paths.json`. When the designer sends a new master EPS, refresh that file first:

```bash
node docs/brand/tahafi/source/extract-from-eps.mjs "<path to Printable File.eps>"
node docs/brand/tahafi/source/build.mjs
```

Colours, type and rules are in [THEME_BLUEPRINT.md](THEME_BLUEPRINT.md).
