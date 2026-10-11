"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { assertUrlSchema, nextSearch, parseUrlState, type UrlAliases, type UrlSchema, type UrlValues } from "@/lib/url-state";

/**
 * Typed, validated view state in the query string (P1.6) — `const [state, setState] = useUrlState(schema)` with a schema
 * from lib/url-state.ts (`urlParam.*`, the q / view / f.* / sort / page / size / tab / from / to / cmp / gran / open /
 * step grammar). Reads straight from `window.location` (no Suspense boundary needed, unlike useSearchParams) and writes
 * with the History API, which Next's App Router observes — the same mechanism the Product Builder uses for `?step=`, so
 * the two coexist on one URL.
 *
 * `history: "replace"` (default) for filters and paging; `"push"` for state the Back button should undo (`open`, `tab`).
 */
export const URL_STATE_EVENT = "admin:urlstatechange";

/** Tell every useUrlState reader the query string changed (after a History API write made outside the hook). */
export function notifyUrlStateChange() {
  window.dispatchEvent(new Event(URL_STATE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(URL_STATE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(URL_STATE_EVENT, onChange);
  };
}
const getSearch = () => window.location.search;
const getServerSearch = () => "";

export function useUrlState<S extends UrlSchema>(
  schema: S,
  { aliases = {}, history = "replace" }: { aliases?: UrlAliases<S>; history?: "replace" | "push" } = {},
): [UrlValues<S>, (patch: Partial<UrlValues<S>> | ((current: UrlValues<S>) => Partial<UrlValues<S>>)) => void] {
  const checked = useRef<S | null>(null);
  if (process.env.NODE_ENV !== "production" && checked.current !== schema) {
    assertUrlSchema(schema);
    checked.current = schema;
  }
  const search = useSyncExternalStore(subscribe, getSearch, getServerSearch);
  // Schema and aliases are module-level constants by convention; the parsed value changes only with the query string.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const values = useMemo(() => parseUrlState(schema, new URLSearchParams(search), aliases), [search]);

  const set = useCallback(
    (patch: Partial<UrlValues<S>> | ((current: UrlValues<S>) => Partial<UrlValues<S>>)) => {
      const current = new URLSearchParams(window.location.search);
      const resolved = typeof patch === "function" ? patch(parseUrlState(schema, current, aliases)) : patch;
      const next = nextSearch(schema, current, resolved, aliases);
      const query = next.toString();
      const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
      if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
      if (history === "push") window.history.pushState(window.history.state, "", url);
      else window.history.replaceState(window.history.state, "", url);
      notifyUrlStateChange();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history],
  );

  return [values, set];
}
