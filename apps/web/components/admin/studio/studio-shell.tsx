"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MousePointerClick } from "lucide-react";
import tokens from "@clothing-brand/ui-tokens";
import { studioHealthChecks, type HomepageSectionType, type StudioSection } from "@clothing-brand/shared";
import { Drawer } from "@/components/ui/drawer";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getCategoryTree, type CategoryTreeNode } from "@/lib/api/storefront";
import { publicRuntimeConfig } from "@/lib/runtime-config";
import { resolveThemeId } from "@/lib/theme";
import { storeLayout } from "@/lib/theme-layout";
import type { StudioDevice } from "@/lib/studio/preview-protocol";
import { useStudioDraft } from "@/lib/studio/use-studio-draft";
import { AddSectionGallery } from "./add-section-gallery";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { Outline } from "./outline";
import { SECTION_META } from "./section-meta";
import { TopBar } from "./top-bar";

const DEVICE_LABEL: Record<StudioDevice, string> = { desktop: "computers", tablet: "tablets", mobile: "phones" };

function flatten(tree: CategoryTreeNode[], depth = 0): { slug: string; name: string }[] {
  return tree.flatMap((c) => [{ slug: c.slug, name: `${"— ".repeat(depth)}${c.name}` }, ...flatten(c.children ?? [], depth + 1)]);
}

function isEditable(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/**
 * The Storefront Studio: the homepage's sections on the left, the page itself in the middle (real size per device,
 * click a section to edit it), and the selected section's settings on the right. Edits are a draft — autosaved, undoable
 * — until Publish.
 */
export function StudioShell() {
  const draft = useStudioDraft();
  const queryClient = useQueryClient();
  const wide = useMediaQuery("(min-width: 1024px)");
  const layout = storeLayout();
  const [device, setDevice] = useState<StudioDevice>("desktop");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [emptyIds, setEmptyIds] = useState<Set<string>>(new Set());
  const [scrollRequest, setScrollRequest] = useState<{ id: string; at: number } | null>(null);
  const [publishErrors, setPublishErrors] = useState<Record<string, string[]>>({});
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const { data: treeData } = useQuery({ queryKey: ["studio-category-tree"], queryFn: getCategoryTree, staleTime: 5 * 60_000 });
  const categories = useMemo(() => flatten(treeData?.tree ?? []), [treeData]);

  // The theme's own light bands, so "two dark sections in a row" only fires where they really are dark.
  const lightBands = useMemo(() => {
    const roles = tokens.themes[resolveThemeId(publicRuntimeConfig().theme)]?.lightBandRoles;
    return roles === null ? ("all" as const) : (roles ?? []);
  }, []);
  const checks = useMemo(() => {
    const found = studioHealthChecks(draft.sections, new Date(), { lightBands });
    // Anything the server refused on the last publish that the client rules didn't catch.
    for (const [sectionId, messages] of Object.entries(publishErrors)) {
      if (!found.some((c) => c.sectionId === sectionId && c.level === "error")) found.push({ sectionId, level: "error", code: "invalid", message: messages[0] ?? "Needs fixing" });
    }
    return found;
  }, [draft.sections, lightBands, publishErrors]);

  // What the server refused applies to the draft it saw — any edit after that clears it (the client rules re-check).
  useEffect(() => setPublishErrors({}), [draft.sections]);

  const selected = draft.sections.find((s) => s.id === draft.selectedId) ?? null;

  function selectAndReveal(id: string) {
    draft.select(id);
    setScrollRequest({ id, at: Date.now() });
  }

  // ⌘Z / ⇧⌘Z / Ctrl+Y — but a text field keeps its own undo while it's focused.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || isEditable(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        draft.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        draft.redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft]);

  async function handlePublish() {
    const result = await draft.publish();
    if (result.ok) {
      setPublishErrors({});
      void queryClient.invalidateQueries({ queryKey: ["studio-revisions"] });
      toast.success("Published — your homepage is live");
    } else {
      setPublishErrors(result.errors);
      const first = Object.keys(result.errors)[0];
      if (first) selectAndReveal(first);
      toast.error(result.message);
    }
  }

  async function handleDiscard() {
    if (!(await confirm("Discard every change since the last publish? The draft goes back to the live homepage.", { confirmLabel: "Discard changes" }))) return;
    await draft.discard();
    setPublishErrors({});
    toast.info("Changes discarded");
  }

  async function handleRestore(revisionId: string, publishedAt: string) {
    const when = new Date(publishedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    if (draft.hasUnpublishedChanges && !(await confirm(`Replace your unpublished changes with the homepage as published on ${when}?`, { confirmLabel: "Restore", tone: "default" }))) return;
    try {
      await draft.restore(revisionId);
      toast.success(`Restored the ${when} version as your draft — publish to make it live`);
    } catch {
      toast.error("Couldn't restore that version");
    }
  }

  async function handleDelete(section: StudioSection) {
    if (!(await confirm(`Delete this ${SECTION_META[section.type].label.toLowerCase()} section? You can undo this until you publish.`, { confirmLabel: "Delete" }))) return;
    draft.remove(section.id);
  }

  function handleAdd(type: HomepageSectionType) {
    setGalleryOpen(false);
    const id = draft.add(type, structuredClone(SECTION_META[type].starter));
    setTimeout(() => setScrollRequest({ id, at: Date.now() }), 250);
  }

  if (draft.status === "loading") {
    return (
      <div className="grid h-full grid-cols-[280px_1fr_360px] gap-px bg-line-subtle" aria-busy="true">
        <div className="space-y-2 bg-surface p-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
        <div className="bg-surface-muted p-6">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
        <div className="space-y-3 bg-surface p-5">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }
  if (draft.status === "error") {
    return (
      <div className="flex h-full items-center justify-center bg-surface-muted p-6">
        <ErrorState title="Couldn't open the homepage editor" description="Check your connection and try again." onRetry={() => void draft.reload()} />
      </div>
    );
  }

  const inspector = selected ? (
    <Inspector
      key={selected.id}
      draft={draft}
      section={selected}
      layout={layout}
      categories={categories}
      checks={checks.filter((c) => c.sectionId === selected.id)}
      emptyOnDevice={emptyIds.has(selected.id)}
      onDelete={handleDelete}
    />
  ) : null;

  return (
    <div className="flex h-full flex-col bg-surface" data-testid="studio">
      <TopBar
        draft={draft}
        device={device}
        onDevice={setDevice}
        checks={checks}
        onPublish={() => void handlePublish()}
        onDiscard={() => void handleDiscard()}
        onRestore={(id, at) => void handleRestore(id, at)}
        onSelectSection={selectAndReveal}
      />
      <div className={wide ? "grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px]" : "grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]"}>
        <aside className="min-h-0 border-r border-line-subtle bg-surface" aria-label="Sections">
          <Outline
            sections={draft.sections}
            selectedId={draft.selectedId}
            checks={checks}
            emptyIds={emptyIds}
            deviceLabel={DEVICE_LABEL[device]}
            onSelect={selectAndReveal}
            onMove={draft.move}
            onToggle={(id, isActive) => draft.update(id, { isActive })}
            onAdd={() => setGalleryOpen(true)}
          />
        </aside>
        <Canvas
          sections={draft.sections}
          selectedId={draft.selectedId}
          device={device}
          onSelect={draft.select}
          onEmptyIds={(ids) => setEmptyIds((prev) => (prev.size === ids.length && ids.every((id) => prev.has(id)) ? prev : new Set(ids)))}
          scrollRequest={scrollRequest}
        />
        {wide && (
          <aside className="min-h-0 border-l border-line-subtle bg-surface" aria-label="Section settings">
            {inspector ?? <NothingSelected />}
          </aside>
        )}
      </div>
      {!wide && (
        <Drawer open={Boolean(selected)} onClose={() => draft.select(null)} title={selected ? SECTION_META[selected.type].label : ""} widthClassName="max-w-[400px]">
          {inspector}
        </Drawer>
      )}
      <AddSectionGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} sections={draft.sections} onAdd={handleAdd} />
      {confirmDialog}
    </div>
  );
}

function NothingSelected() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted text-fg-muted">
        <MousePointerClick size={22} aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-fg">Click any part of the page to edit it</p>
      <p className="text-xs leading-relaxed text-fg-muted">
        Or pick a section on the left. Changes show here instantly and are saved as a draft — shoppers see them only after you publish.
      </p>
    </div>
  );
}
