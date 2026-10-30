# `tahafi` preset

Every piece comes from the logo's mark (twin diamonds over a curved bar).

- `hero.tsx`: the classic `Hero` on olive, its photograph framed by the canopy (`.ui-canopy` in globals.css: the top edge dips like the bar of the mark) with the twin diamonds seated in the dip (`mediaCrown`). The small line above the headline moves onto the hang-tag. Without a photograph it falls back to the classic hero.
- `hang-tag.tsx`: the garment hang-tag on a sage thread (`--tag-thread`), its shape from the `.ui-hang-tag` recipe in globals.css. Its text is split at `|` into name, detail and price.
- `twin-diamonds.tsx`: the two diamonds of the mark, in the current colour. The same shape marks every section title through the `--title-mark` token (CSS, no component).
- `loader.tsx`: the loading state — the two diamonds take turns.
- `header.tsx`: the classic header under the olive strip of the store's delivery promises (the mihrab preset's strip; `ink-950` is olive in this theme).

Everything else renders the classic components, styled by the `tahafi` tokens. Brand rules: docs/brand/tahafi/THEME_BLUEPRINT.md.
