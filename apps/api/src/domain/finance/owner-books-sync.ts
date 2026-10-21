/**
 * Everything the owner's books book by themselves (docs/FINANCE_OWNER_BOOKS.md §10): packaging of parcels that left,
 * each campaign's daily spend, and each prepaid cost's monthly share. Run by the finance sync cron after the commerce
 * projector (which books the courier and gateway estimates with each order), and on demand. Each part is idempotent.
 */
import { syncAllAdSpend } from "./ads.service";
import { syncAllPrepaid } from "./prepaid.service";
import { syncPackaging } from "./packaging.service";
import { getFinanceContext } from "./finance-context";
import { booksStarted } from "./finance-facts";

export async function syncOwnerBooks() {
  const ctx = await getFinanceContext();
  const packaging = await syncPackaging();
  if (!(await booksStarted(ctx))) return { skipped: "BOOKS_NOT_STARTED" as const, packaging, ads: null, prepaid: null };
  return { packaging, ads: await syncAllAdSpend(), prepaid: await syncAllPrepaid() };
}
