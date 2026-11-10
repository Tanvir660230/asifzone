/**
 * A partial delivery: the courier says the customer kept part of the parcel and paid for it. Which units came back is
 * what staff must record — this guesses it from the money the courier collected, so the common case is one tap: find
 * the ways of keeping some units whose price (with or without the delivery charge) adds up to what was collected. Only
 * a single exact answer is offered; when two splits fit (or none), nothing is guessed and staff enter it themselves.
 */
export interface PartialLine {
  id: string;
  quantity: number;
  /** Price of one unit as sold. */
  unitPrice: number;
}

export interface PartialGuess {
  /** Units sent back, per line id. */
  returned: Record<string, number>;
  /** Whether the delivery charge was part of what the courier collected. */
  withDelivery: boolean;
}

const MAX_COMBINATIONS = 20_000;

/** Every "kept" choice: 0..quantity of each line (bounded — a huge order is never searched). */
function* keptChoices(lines: PartialLine[]): Generator<number[]> {
  const kept = lines.map(() => 0);
  let n = 0;
  while (true) {
    if (++n > MAX_COMBINATIONS) return;
    yield [...kept];
    let i = 0;
    while (i < lines.length && kept[i] === lines[i]!.quantity) kept[i++] = 0;
    if (i === lines.length) return;
    kept[i]! += 1;
  }
}

export function guessPartialReturn(lines: PartialLine[], collected: number | null, deliveryCharge: number, tolerance = 1): PartialGuess | null {
  if (collected === null || !Number.isFinite(collected) || collected <= 0 || lines.length === 0) return null;
  const answers: PartialGuess[] = [];
  for (const kept of keptChoices(lines)) {
    const keptUnits = kept.reduce((s, k) => s + k, 0);
    const total = lines.reduce((s, l, i) => s + l.unitPrice * kept[i]!, 0);
    const allKept = kept.every((k, i) => k === lines[i]!.quantity);
    // Kept nothing or everything isn't a partial delivery.
    if (keptUnits === 0 || allKept) continue;
    for (const withDelivery of deliveryCharge > 0 ? [true, false] : [false]) {
      if (Math.abs(total + (withDelivery ? deliveryCharge : 0) - collected) <= tolerance) {
        answers.push({ returned: Object.fromEntries(lines.map((l, i) => [l.id, l.quantity - kept[i]!])), withDelivery });
      }
    }
    if (answers.length > 1) return null;
  }
  return answers.length === 1 ? answers[0]! : null;
}
