"use client";

import { useEffect, useState } from "react";
import { BookmarkPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { notifyUrlStateChange } from "@/hooks/use-url-state";

/**
 * Views (P1.8 saved-view foundation): a named query string for a list screen. System views are declared by the screen
 * ("Unpaid", "Needs courier"); an admin can save the current filters as a personal view. A view is applied by replacing
 * the list's URL state with its query plus `view=<id>` — the URL stays the single source of truth.
 *
 * Personal views live in this browser for now (useSavedViews); the shape is what a server-side store will hold later.
 */
export interface ListView {
  id: string;
  label: string;
  /** The URL-state query this view applies (no leading "?"), e.g. "f.queue=unpaid&sort=-createdAt". */
  query: string;
  system?: boolean;
}

/** Keys a view doesn't carry (paging is per visit). */
const NOT_SAVED = new Set(["page", "view", "open"]);

export function currentViewQuery(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) if (NOT_SAVED.has(key)) params.delete(key);
  params.sort();
  return params.toString();
}

export function applyView(view: ListView) {
  const params = new URLSearchParams(view.query);
  params.set("view", view.id);
  const url = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(window.history.state, "", url);
  notifyUrlStateChange();
}

/** This admin's saved views for one list (per browser — a convenience; the list works without it). */
export function useSavedViews(listKey: string) {
  const storageKey = `views:${listKey}`;
  const [views, setViews] = useState<ListView[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setViews((JSON.parse(raw) as ListView[]).filter((v) => v && typeof v.id === "string" && typeof v.query === "string"));
    } catch {
      setViews([]);
    }
  }, [storageKey]);
  function persist(next: ListView[]) {
    setViews(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Kept for this visit only.
    }
  }
  return {
    views,
    save: (label: string, query: string) => persist([...views, { id: `saved-${Date.now().toString(36)}`, label, query }]),
    remove: (id: string) => persist(views.filter((v) => v.id !== id)),
  };
}

export function ViewBar({ listKey, systemViews, activeViewId, search }: { listKey: string; systemViews: ListView[]; activeViewId: string; search: string }) {
  const { views, save, remove } = useSavedViews(listKey);
  const all = [...systemViews.map((v) => ({ ...v, system: true })), ...views];
  const currentQuery = currentViewQuery(search);
  const matching = all.find((v) => v.id === activeViewId) ?? all.find((v) => currentViewQuery(v.query) === currentQuery);

  return (
    <div role="tablist" aria-label="Views" className="flex flex-wrap items-center gap-1 border-b border-line-subtle">
      {all.map((view) => {
        const active = matching?.id === view.id;
        return (
          <span key={view.id} className="flex items-center">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => applyView(view)}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", active ? "border-accent text-fg" : "border-transparent text-fg-subtle hover:text-ink-700")}
            >
              {view.label}
            </button>
            {!view.system && (
              <button type="button" onClick={() => remove(view.id)} aria-label={`Delete view ${view.label}`} className="text-ink-300 hover:text-ink-600">
                <X size={12} />
              </button>
            )}
          </span>
        );
      })}
      {currentQuery && !matching && (
        <button
          type="button"
          onClick={() => {
            const label = window.prompt("Name this view");
            if (label?.trim()) save(label.trim(), currentQuery);
          }}
          className="ml-auto flex items-center gap-1 px-2 py-2 text-xs font-medium text-ink-500 hover:text-ink-800"
        >
          <BookmarkPlus size={14} /> Save view
        </button>
      )}
    </div>
  );
}
