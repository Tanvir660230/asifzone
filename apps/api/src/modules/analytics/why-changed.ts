/**
 * "Why did it change" (docs/METRICS_REGISTRY.md §4.11). A metric that is a product of factors (orders = visits ×
 * conversion; net sales = realised orders × AOV) has its period-over-period change split into each factor's effect with
 * the logarithmic mean Divisia index: effect_i = L(Y₁, Y₀) · ln(x_i₁ / x_i₀), L(a, b) = (a − b) / (ln a − ln b). The
 * effects add up EXACTLY to the change — no unexplained remainder. Pure.
 */

export interface Decomposition<K extends string> {
  before: number;
  after: number;
  total: number;
  effects: Record<K, number>;
}

const product = (xs: number[]) => xs.reduce((p, x) => p * x, 1);

/** `factors[k] = [before, after]`. */
export function decompose<K extends string>(factors: Record<K, [number, number]>): Decomposition<K> {
  const keys = Object.keys(factors) as K[];
  const before = product(keys.map((k) => factors[k][0]));
  const after = product(keys.map((k) => factors[k][1]));
  const total = after - before;
  const effects = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  if (total === 0) return { before, after, total, effects };

  const positive = keys.every((k) => factors[k][0] > 0 && factors[k][1] > 0);
  if (positive) {
    const L = (after - before) / (Math.log(after) - Math.log(before));
    for (const k of keys) effects[k] = L * Math.log(factors[k][1] / factors[k][0]);
    return { before, after, total, effects };
  }
  // A zero factor (no orders in one period): log is undefined. Split by each factor's share of the summed relative
  // moves, which still adds up to the total.
  const moves = keys.map((k) => Math.abs(factors[k][1] - factors[k][0]) / Math.max(Math.abs(factors[k][0]), Math.abs(factors[k][1]), 1e-9));
  const sum = moves.reduce((s, m) => s + m, 0) || 1;
  keys.forEach((k, i) => (effects[k] = (total * moves[i]!) / sum));
  return { before, after, total, effects };
}

export interface Mover {
  key: string;
  before: number;
  after: number;
  change: number;
}

/** The `limit` biggest rises and falls of a grouped value between two periods (a group missing from one counts as 0). */
export function movers(before: Map<string, number>, after: Map<string, number>, limit = 5): { up: Mover[]; down: Mover[] } {
  const keys = new Set([...before.keys(), ...after.keys()]);
  const all = [...keys].map((key) => {
    const b = before.get(key) ?? 0;
    const a = after.get(key) ?? 0;
    return { key, before: b, after: a, change: a - b };
  });
  return {
    up: all.filter((m) => m.change > 0).sort((x, y) => y.change - x.change).slice(0, limit),
    down: all.filter((m) => m.change < 0).sort((x, y) => x.change - y.change).slice(0, limit),
  };
}
