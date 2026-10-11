"use client";

import { useEffect, useMemo, useState } from "react";
import { clearFiltersPatch, filterSchema, type FilterDefinition, type FilterValues } from "@/lib/admin/filters";
import { urlParam, type UrlAliases, type UrlSchema } from "@/lib/url-state";
import { useUrlState } from "@/hooks/use-url-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/**
 * A list screen's search + filters + paging, persisted in the URL (P1.6 / P1.8): `q`, one `f.*` per filter definition,
 * `page` and `size`. The search box types into local state and reaches the URL debounced, so typing doesn't spam history
 * or refetch per keystroke. Changing search or any filter returns to page 1 (the URL-state grammar does that).
 */
export function useFilterState(
  defs: readonly FilterDefinition[],
  { pageSizes = [10, 20, 50], defaultPageSize = 20, aliases }: { pageSizes?: readonly number[]; defaultPageSize?: number; aliases?: Record<string, string> } = {},
) {
  // Definitions are module-level constants — the schema is built once per definition set.
  const schema = useMemo(
    () => ({ q: urlParam.string(), page: urlParam.page(), size: urlParam.size(pageSizes, defaultPageSize), ...filterSchema(defs) }) as UrlSchema,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defs],
  );
  const [state, setState] = useUrlState(schema, { aliases: aliases as UrlAliases<UrlSchema> | undefined });
  const values = state as unknown as FilterValues & { q: string; page: number; size: number };

  const [search, setSearch] = useState(values.q);
  const debounced = useDebouncedValue(search, 350);
  useEffect(() => {
    if (debounced !== values.q) setState({ q: debounced } as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  // Back/forward or a view switch changed q underneath the box.
  useEffect(() => setSearch(values.q), [values.q]);

  return {
    values,
    search,
    setSearch,
    setFilters: (patch: FilterValues) => setState(patch as never),
    setPage: (page: number) => setState({ page } as never),
    setPageSize: (size: number) => setState({ size } as never),
    clearAll: () => {
      setSearch("");
      setState({ q: "", ...clearFiltersPatch(defs) } as never);
    },
  };
}
