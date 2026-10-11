"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { notifyUrlStateChange } from "@/hooks/use-url-state";
import * as adminHomeApi from "@/lib/api/admin-home";
import { savedViewKeys } from "@/lib/query-keys";
import { SaveViewButton } from "./save-view-button";

/**
 * Views (P1.8 saved-view foundation): a named query string for a list screen. System views are declared by the screen
 * ("Unpaid", "Needs courier"); an admin can save the current filters as a personal view. A view is applied by replacing
 * the list's URL state with its query plus `view=<id>` — the URL stays the single source of truth.
 *
 * Saved views are stored server-side per admin (useSavedViews, DR-18); a shared one is visible to the whole team.
 */
export interface ListView {
  id: string;
  label: string;
  /** The URL-state query this view applies (no leading "?"), e.g. "f.queue=unpaid&sort=-createdAt". */
  query: string;
  system?: boolean;
  /** Saved by this admin (only they can delete it). */
  mine?: boolean;
  /** Shared with the team. */
  shared?: boolean;
  createdBy?: string | null;
}

/** Keys a view doesn't carry (paging is per visit). */
const NOT_SAVED = new Set(["page", "view", "open"]);

/** The part of a list URL a view saves. `keepView` for lists whose `view` key is list state (Orders: active/trash). */
export function currentViewQuery(search: string, { keepView = false }: { keepView?: boolean } = {}): string {
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) if (NOT_SAVED.has(key) && !(keepView && key === "view")) params.delete(key);
  params.sort();
  return params.toString();
}

/** Applies a saved query as the list's URL state (a history entry, so Back returns to the previous filters). */
export function applyQuery(query: string) {
  const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.pushState(window.history.state, "", url);
  notifyUrlStateChange();
}

export function applyView(view: ListView) {
  const params = new URLSearchParams(view.query);
  params.set("view", view.id);
  const url = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(window.history.state, "", url);
  notifyUrlStateChange();
}

/** This admin's saved views for one list plus the team's shared ones (DR-18 — server-side, so they follow the admin
 * across devices). A failed load leaves the list working with system views only. */
export function useSavedViews(listKey: string) {
  const queryClient = useQueryClient();
  const key = savedViewKeys.list(listKey);
  const { data } = useQuery({ queryKey: key, queryFn: () => adminHomeApi.listSavedViews(listKey), staleTime: 5 * 60_000 });
  const views: ListView[] = (data?.items ?? []).map((v) => ({ id: v.id, label: v.label, query: v.query, mine: v.mine, shared: v.shared, createdBy: v.createdBy }));
  const create = useMutation({
    mutationFn: (input: { label: string; query: string; shared?: boolean }) => adminHomeApi.createSavedView({ listKey, ...input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const del = useMutation({
    mutationFn: adminHomeApi.deleteSavedView,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return {
    views,
    save: (label: string, query: string, shared = false) => create.mutateAsync({ label, query, shared }),
    remove: (id: string) => del.mutateAsync(id),
    saving: create.isPending,
  };
}

export function ViewBar({ listKey, systemViews, activeViewId, search }: { listKey: string; systemViews: ListView[]; activeViewId: string; search: string }) {
  const { views, save, remove, saving } = useSavedViews(listKey);
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
            {view.mine && (
              <button type="button" onClick={() => remove(view.id)} aria-label={`Delete view ${view.label}`} className="text-ink-300 hover:text-ink-600">
                <X size={12} />
              </button>
            )}
          </span>
        );
      })}
      {currentQuery && !matching && <SaveViewButton className="ml-auto" saving={saving} onSave={(label, shared) => save(label, currentQuery, shared)} />}
    </div>
  );
}
