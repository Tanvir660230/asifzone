"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MousePointerClick } from "lucide-react";
import tokens from "@clothing-brand/ui-tokens";
import { studioDesignChecks, studioHealthChecks, type HomepageSectionType, type StudioSection } from "@clothing-brand/shared";
import { Drawer } from "@/components/ui/drawer";
import { SegmentedControl } from "@/components/ui/tabs";
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
import { cn } from "@/lib/utils";
import { AddSectionGallery } from "./add-section-gallery";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { Outline } from "./outline";
import { DesignInspector, DesignOutline } from "./design-panels";
import { DESIGN_META, designGroupOf } from "./design-meta";
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
  // Phones edit too: one pane at a time (sections, site design or the preview), the settings in a full-screen sheet,
  // and the preview always at phone width.
  const phone = useMediaQuery("(max-width: 767px)");
  const layout = storeLayout();
  const [chosenDevice, setDevice] = useState<StudioDevice>("desktop");
  const device: StudioDevice = phone ? "mobile" : chosenDevice;
  const [previewing, setPreviewing] = useState(false);
  // The left pane: the homepage's sections, or the store-wide design (theme, announcement bar, header, footer).
  const [mode, setMode] = useState<"page" | "design">("page");
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
    const found = [...studioHealthChecks(draft.sections, new Date(), { lightBands }), ...studioDesignChecks(draft.design)];
    // Anything the server refused on the last publish that the client rules didn't catch.
    for (const [sectionId, messages] of Object.entries(publishErrors)) {
      if (!found.some((c) => c.sectionId === sectionId && c.level === "error")) found.push({ sectionId, level: "error", code: "invalid", message: messages[0] ?? "Needs fixing" });
    }
    return found;
  }, [draft.sections, draft.design, lightBands, publishErrors]);

  // What the server refused applies to the draft it saw — any edit after that clears it (the client rules re-check).
  useEffect(() => setPublishErrors({}), [draft.sections, draft.design]);

  const selected = draft.sections.find((s) => s.id === draft.selectedId) ?? null;
  const selectedGroup = designGroupOf(draft.selectedId);

  // A click in the preview (or a check) may pick the header or footer: show the tab it belongs to.
  useEffect(() => {
    if (selectedGroup) setMode("design");
    else if (selected) setMode("page");
  }, [selectedGroup, selected]);

  function selectAndReveal(id: string) {
    draft.select(id);
    if (designGroupOf(id) === "theme") return;
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

  const inspector = selectedGroup ? (
    <DesignInspector
      key={selectedGroup}
      draft={draft}
      group={selectedGroup}
      layout={layout}
      categories={categories}
      checks={checks.filter((c) => c.sectionId === draft.selectedId)}
    />
  ) : selected ? (
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

  const outline =
    mode === "page" ? (
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
    ) : (
      <DesignOutline design={draft.design} selectedId={draft.selectedId} checks={checks} onSelect={selectAndReveal} />
    );

  const canvas = (
    <Canvas
      sections={draft.sections}
      design={draft.design}
      selectedId={draft.selectedId}
      device={device}
      onSelect={draft.select}
      onEmptyIds={(ids) => setEmptyIds((prev) => (prev.size === ids.length && ids.every((id) => prev.has(id)) ? prev : new Set(ids)))}
      scrollRequest={scrollRequest}
    />
  );

  return (
    <div className="flex h-full flex-col bg-surface" data-testid="studio">
      <TopBar
        compact={phone}
        draft={draft}
        device={device}
        onDevice={setDevice}
        checks={checks}
        onPublish={() => void handlePublish()}
        onDiscard={() => void handleDiscard()}
        onRestore={(id, at) => void handleRestore(id, at)}
        onSelectSection={selectAndReveal}
      />
      {phone ? (
        <>
          <div className="border-b border-line-subtle px-3 py-2">
            <SegmentedControl
              aria-label="What to show"
              size="sm"
              className="w-full"
              value={previewing ? "preview" : mode}
              onChange={(next) => {
                setPreviewing(next === "preview");
                if (next !== "preview" && next !== mode) {
                  setMode(next);
                  draft.select(null);
                }
              }}
              options={[
                { value: "page", label: "Sections", testId: "studio-mode-page" },
                { value: "design", label: "Site design", testId: "studio-mode-design" },
                { value: "preview", label: "Preview", testId: "studio-pane-preview" },
              ]}
            />
          </div>
          <div className="relative min-h-0 flex-1">
            {/* The preview stays laid out (only invisible) under the lists: it doesn't reload on every switch, and its
                real size keeps the outline's "takes no space on a phone" measurement right. */}
            <div className={cn("absolute inset-0", !previewing && "invisible")} aria-hidden={!previewing || undefined}>
              {canvas}
            </div>
            {!previewing && (
              <div role="region" aria-label={mode === "page" ? "Sections" : "Site design"} className="absolute inset-0 bg-surface">
                {outline}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className={wide ? "grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px]" : "grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]"}>
          <aside className="flex min-h-0 flex-col border-r border-line-subtle bg-surface" aria-label={mode === "page" ? "Sections" : "Site design"}>
            <div className="border-b border-line-subtle px-3 py-3">
              <SegmentedControl
                aria-label="What to edit"
                size="sm"
                className="w-full"
                value={mode}
                onChange={(next) => {
                  setMode(next);
                  draft.select(null);
                }}
                options={[
                  { value: "page", label: "Homepage", testId: "studio-mode-page" },
                  { value: "design", label: "Site design", testId: "studio-mode-design" },
                ]}
              />
            </div>
            <div className="min-h-0 flex-1">{outline}</div>
          </aside>
          {canvas}
          {wide && (
            <aside className="min-h-0 border-l border-line-subtle bg-surface" aria-label="Section settings">
              {inspector ?? <NothingSelected />}
            </aside>
          )}
        </div>
      )}
      {!wide && (
        <Drawer
          open={Boolean(selected || selectedGroup)}
          onClose={() => draft.select(null)}
          title={selectedGroup ? DESIGN_META[selectedGroup].label : selected ? SECTION_META[selected.type].label : ""}
          widthClassName={phone ? "max-w-none" : "max-w-[400px]"}
        >
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
