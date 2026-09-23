import type { PrismaClient } from "@prisma/client";

/**
 * Tests here run against a real database and clean up after themselves with `deleteMany({ where: { categoryId } })`. Prisma treats
 * an `undefined` value in a filter as "no filter": if a test's setup failed halfway, `categoryId` is still `undefined` in its
 * cleanup, the where clause silently becomes `{}`, and the cleanup deletes **every** row of the table. That is exactly how a run
 * once wiped the dev database's products, categories and product types.
 *
 * This guard, installed for every test file (see test-setup.ts), refuses a `deleteMany` / `updateMany` whose filter is effectively
 * empty, so a broken setup fails loudly at cleanup instead of taking the data with it.
 */

/** Tables where clearing everything is intended (the test owns the whole table's contents). */
const UNFILTERED_OK = new Set(["GlobalSection"]);

/** True when a where clause would match every row: nothing in it once `undefined` values are ignored, or an `OR` with such a clause in it. */
export function isEmptyClause(where: unknown): boolean {
  if (where === undefined || where === null) return true;
  if (typeof where !== "object") return false;
  const entries = Object.entries(where as Record<string, unknown>).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return true;
  const or = (where as { OR?: unknown }).OR;
  return entries.length === 1 && Array.isArray(or) && or.some(isEmptyClause);
}

export function installUnfilteredDeleteGuard(prisma: PrismaClient): void {
  (prisma as unknown as { $use: (fn: (params: { model?: string; action: string; args?: { where?: unknown } }, next: (p: unknown) => Promise<unknown>) => Promise<unknown>) => void }).$use(
    async (params, next) => {
      if ((params.action === "deleteMany" || params.action === "updateMany") && !UNFILTERED_OK.has(params.model ?? "") && isEmptyClause(params.args?.where)) {
        throw new Error(
          `[test guard] Refusing ${params.model}.${params.action} with no effective filter — a variable in its where clause is probably undefined ` +
            `(a failed beforeAll?). Run unfiltered, it would touch every row of the table.`,
        );
      }
      return next(params);
    },
  );
}
