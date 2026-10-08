"use client";

import { useEffect, useState } from "react";
import { useShortcut } from "@/hooks/use-shortcut";

// "collapsed" | "expanded" once the admin has chosen; absent = follow the window width.
const COLLAPSE_STORAGE_KEY = "admin-sidebar";
const AUTO_COLLAPSE_QUERY = "(max-width: 1279px)";

/**
 * The desktop sidebar's width, owned by the shell: the sidebar draws it, and the section bar shows a module's pages only
 * while the sidebar isn't listing them itself. The admin's own choice (button or Ctrl/⌘ \) wins; without one the rail
 * follows the window — collapsed below `xl`, where a 248px list squeezes the page.
 *
 * Both are read after mount (no localStorage / matchMedia during SSR) — starting expanded avoids a hydration mismatch, at
 * the cost of a brief flash for an admin whose rail starts collapsed.
 */
export function useSidebarCollapse(): { collapsed: boolean; toggle: () => void } {
  const [preference, setPreference] = useState<boolean | null>(null);
  const [narrowWindow, setNarrowWindow] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (saved === "collapsed" || saved === "expanded") setPreference(saved === "collapsed");
    } catch {
      // storage blocked — follow the window
    }
    const query = window.matchMedia(AUTO_COLLAPSE_QUERY);
    const sync = () => setNarrowWindow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const collapsed = preference ?? narrowWindow;

  function toggle() {
    const next = !collapsed;
    setPreference(next);
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "collapsed" : "expanded");
    } catch {
      // storage blocked — the choice lasts for this visit
    }
  }
  useShortcut("sidebar.toggle", (event) => {
    event.preventDefault();
    toggle();
  });

  return { collapsed, toggle };
}
