/**
 * Where each category tile goes, for any number of categories, with exactly one cell per category (no empty cells).
 *  - From 1024px, on 12 columns: up to 4 categories share one row; from 5, the first row is two wide feature tiles and the
 *    rest fill balanced rows of at most 4.
 *  - Below, on 2 columns: the first tile spans the row, then pairs; an odd one out spans the last row.
 */
export function categoryTileLayout(count: number): Array<{ lg: number; sm: number }> {
  if (count <= 0) return [];
  const lg: number[] = [];
  if (count <= 4) {
    lg.push(...Array<number>(count).fill(12 / count));
  } else {
    lg.push(6, 6);
    const rest = count - 2;
    const rows = Math.ceil(rest / 4);
    const base = Math.floor(rest / rows);
    const longer = rest % rows;
    for (let row = 0; row < rows; row++) {
      const perRow = base + (row < longer ? 1 : 0);
      lg.push(...Array<number>(perRow).fill(12 / perRow));
    }
  }
  const lastIsAlone = (count - 1) % 2 === 1;
  return lg.map((span, i) => ({ lg: span, sm: i === 0 || (lastIsAlone && i === count - 1) ? 2 : 1 }));
}
