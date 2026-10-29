"use client";

import { useQuery } from "@tanstack/react-query";
import * as adminOrdersApi from "@/lib/api/admin-orders";

/**
 * Blueprint P0.4: whether the store's returns rule is in force — an agreed return then waits for its goods (Goods awaiting
 * return) and their condition is recorded when they are received, never at the agreement. Off (or still loading): the
 * screens keep today's restock-at-approval wording and inputs.
 */
export function useReturnsRule() {
  const q = useQuery({ queryKey: adminOrdersApi.returnsRuleKey, queryFn: adminOrdersApi.getReturnsRule, staleTime: 60_000 });
  return { awaitGoods: q.data?.active === true, rule: q.data };
}
