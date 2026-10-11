/**
 * The one way the Financial Core opens a transaction (architecture guard: finance-writers.guard.test.ts).
 *
 * The audit-atomicity rule (F-6) and the balanced-at-commit rule (F-2) are DEFERRED constraint triggers: they run at
 * COMMIT. Prisma's interactive transactions don't surface an error raised at COMMIT — the database rolls the transaction
 * back, but `$transaction` resolves as if it had committed, so a caller would report success for a change that never
 * happened. Ending every finance transaction with SET CONSTRAINTS ALL IMMEDIATE runs those checks inside the callback,
 * where a violation rejects the call (and rolls everything back) like any other error.
 */
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { mapFinanceDbError } from "./finance-values";

export async function financeTransaction<T>(fn: (tx: AppTransactionClient) => Promise<T>, options: { timeout?: number } = {}): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const result = await fn(tx);
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return result;
      },
      { timeout: options.timeout ?? 20_000 },
    );
  } catch (err) {
    throw mapFinanceDbError(err);
  }
}
