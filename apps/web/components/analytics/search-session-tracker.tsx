"use client";

import { useEffect } from "react";
import { trackSearchSession } from "@/lib/analytics";

/** Renders nothing — fires the search-session correlation beacon once per distinct query, same
 * "tracker component dropped into the page" idiom as PageViewTracker. Lives on the search-results
 * page specifically (not globally) since that's the only place a real search query is known. */
export function SearchSessionTracker({ query }: { query?: string }) {
  useEffect(() => {
    if (query) trackSearchSession(query);
  }, [query]);

  return null;
}
