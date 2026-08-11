/** The `findMany`+`count`+`{items,total,page,pageSize}` shape repeated across every paginated
 * admin list in this codebase (orders, customers, coupons, products, reviews, ...) — one helper
 * so page-math (skip/take) and the response envelope can't drift between call sites. `findMany`
 * and `count` still run in parallel, same as the hand-written `Promise.all` this replaces. */
export async function paginate<T>(
  query: { page: number; pageSize: number },
  findMany: (args: { skip: number; take: number }) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<{ items: T[]; total: number; page: number; pageSize: number }> {
  const skip = (query.page - 1) * query.pageSize;
  const [items, total] = await Promise.all([findMany({ skip, take: query.pageSize }), count()]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}
