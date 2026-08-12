/** Runs `fn` over `items` with at most `concurrency` in flight at once — a plain `Promise.all`
 * would fire every item's work simultaneously; a `for` loop would run them fully serially. Each
 * item's outcome is independent (callers try/catch inside `fn`), so ordering doesn't matter. */
export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
