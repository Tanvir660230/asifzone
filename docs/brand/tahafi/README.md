# Tahafi brand files

| File | Use | Upload in |
|---|---|---|
| `png/tahafi-logo.png` | wordmark, olive-black | Admin → Settings → Store & branding → Logo |
| `png/tahafi-logo-on-dark.png` | wordmark, cream | → Logo on dark backgrounds |
| `png/tahafi-favicon-512.png` (`-32.png`) | the hang-tag "T" | → Favicon |
| `png/tahafi-og-image-1200x630.png` | link previews | → Social image |
| `*.svg` | vector masters (letters outlined, no font needed) | print, signage, packaging |
| `sample/*.jpg` | sample-store photos, cut from the owner's first AI design board | local preview only — replace with a real shoot |

Regenerate everything from `source/build.mjs`. It needs Instrument Serif and Geist (SIL OFL) in a fonts folder, plus opentype.js:

```bash
OPENTYPE=<path>/node_modules/opentype.js FONTS=<fonts dir> node docs/brand/tahafi/source/build.mjs
```

Colours, type and rules are in [THEME_BLUEPRINT.md](THEME_BLUEPRINT.md).
