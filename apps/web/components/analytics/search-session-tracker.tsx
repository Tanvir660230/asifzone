"use client";

import { useEffect } from "react";
import { trackSearchSession } from "@/lib/analytics";
import { pixelSearch } from "@/lib/pixels";

/** Renders nothing — fires the search-session correlation beacon and the ad-pixel Search event once per distinct query, same
 * "tracker component dropped into the page" idiom as PageViewTracker. Lives on the search-results
 * page specifically (not globally) since that's the only place a real search query is known. */
export function SearchSessionTracker({ query }: { query?: string }) {
  useEffect(() => {
    if (!query) return;
    trackSearchSession(query);
    pixelSearch(query);
  }, [query]);

  return null;
}
