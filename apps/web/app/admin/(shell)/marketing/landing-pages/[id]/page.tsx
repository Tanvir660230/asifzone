"use client";

import { use, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, Copy, ExternalLink, GripVertical, Megaphone, Monitor, Plus, Smartphone, Trash2 } from "lucide-react";
import {
  LANDING_SECTION_LABELS,
  LANDING_SINGLETON_SECTIONS,
  defaultLandingSection,
  landingPageContentSchema,
  slugify,
  type LandingPageContent,
  type LandingPageDetail,
  type LandingSection,
  type LandingSectionType,
} from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { PermissionState } from "@/components/admin/permission-state";
import { ProductPicker } from "@/components/admin/product-picker";
import { SectionFields } from "@/components/admin/landing/section-fields";
import { VariantChooser } from "@/components/admin/landing/variant-chooser";
import { useCapabilities } from "@/hooks/use-capability";
import * as api from "@/lib/api/admin-landing-pages";
import { getProduct } from "@/lib/api/products";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Draft = { name: string; slug: string; content: LandingPageContent };
type SaveState = "saved" | "dirty" | "saving" | "invalid" | "error";

const AUTOSAVE_MS = 900;

/**
 * Marketing › Landing pages › one campaign page. Left: the product and its variants, the sections (drag to reorder, switch
 * off, edit), the design and sharing settings. Right: the working copy rendered exactly as the live page, reloaded after
 * each autosave. Visitors see nothing of it until Publish; after that, changes wait for "Publish changes".
 */
export default function LandingPageEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, ready } = useCapabilities();
  const allowed = can("promotions.manage");
  const page = useQuery({ queryKey: ["admin", "landing-page", id], queryFn: () => api.getLandingPage(id), enabled: allowed, refetchOnWindowFocus: false });

  if (ready && !allowed) return <PermissionState icon={Megaphone} page="Landing pages" />;
  if (page.error) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-base font-medium text-fg">{page.error instanceof ApiError && page.error.status === 404 ? "This landing page doesn't exist any more." : "The page couldn't be loaded."}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" onClick={() => void page.refetch()}>
            Try again
          </Button>
          <Link href="/admin/marketing/landing-pages" className="inline-flex h-10 items-center px-4 text-sm font-medium text-accent">
            All landing pages
          </Link>
        </div>
      </div>
    );
  }
  if (!page.data) return <EditorSkeleton />;
  return <Editor key={page.data.page.id} initial={page.data.page} />;
}

function EditorSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the page">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Skeleton className="h-[32rem]" />
        <Skeleton className="hidden h-[32rem] lg:block" />
      </div>
    </div>
  );
}

function Editor({ initial }: { initial: LandingPageDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  const [meta, setMeta] = useState(initial);
  const [draft, setDraft] = useState<Draft>({ name: initial.name, slug: initial.slug, content: initial.content });
  const [state, setState] = useState<SaveState>("saved");
  const [problem, setProblem] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const [open, setOpen] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const version = useRef(initial.version);
  const productName = useRef<string>(initial.productName);

  const product = useQuery({ queryKey: ["admin", "product", draft.content.productId], queryFn: () => getProduct(draft.content.productId) });

  // Autosave: a moment after the last change, the draft is checked here first (the same schema the server uses), then sent.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState("dirty");
    const parsed = landingPageContentSchema.safeParse(draft.content);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      setProblem(describeIssue(issue.path, issue.message, draft.content));
      setState("invalid");
      return;
    }
    if (!draft.name.trim() || !draft.slug) {
      setProblem(!draft.name.trim() ? "Give the page a name." : "Give the page an address.");
      setState("invalid");
      return;
    }
    const t = setTimeout(() => save.mutate(), AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const save = useMutation({
    mutationFn: () => api.saveLandingPage(meta.id, { ...draft, version: version.current }),
    onMutate: () => setState("saving"),
    onSuccess: ({ page }) => {
      version.current = page.version;
      setMeta(page);
      setProblem(null);
      setState("saved");
      setPreviewKey((k) => k + 1);
      void queryClient.invalidateQueries({ queryKey: ["admin", "landing-pages"] });
    },
    onError: (err) => {
      setState("error");
      setProblem(err instanceof ApiError ? err.message : "Couldn't save — check your connection. Your changes are still here.");
    },
  });

  const publish = useMutation({
    mutationFn: () => api.publishLandingPage(meta.id),
    onSuccess: ({ page }) => {
      setMeta(page);
      version.current = page.version;
      toast.success(meta.status === "PUBLISHED" ? "Changes are live" : "Page is live");
      void queryClient.invalidateQueries({ queryKey: ["admin", "landing-pages"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't publish — try again"),
  });

  const unpublish = useMutation({
    mutationFn: () => api.unpublishLandingPage(meta.id),
    onSuccess: ({ page }) => {
      setMeta(page);
      toast.success("Page taken down — its link now shows “not found”");
      void queryClient.invalidateQueries({ queryKey: ["admin", "landing-pages"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't unpublish — try again"),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteLandingPage(meta.id),
    onSuccess: () => {
      toast.success("Page deleted");
      void queryClient.invalidateQueries({ queryKey: ["admin", "landing-pages"] });
      router.push("/admin/marketing/landing-pages");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't delete — try again"),
  });

  const setContent = (patch: Partial<LandingPageContent>) => setDraft((d) => ({ ...d, content: { ...d.content, ...patch } }));
  const setSection = (next: LandingSection) => setContent({ sections: draft.content.sections.map((s) => (s.id === next.id ? next : s)) });
  const sections = draft.content.sections;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = sections.findIndex((s) => s.id === e.active.id);
    const to = sections.findIndex((s) => s.id === e.over!.id);
    setContent({ sections: arrayMove(sections, from, to) });
  }

  function addSection(type: LandingSectionType) {
    const s = defaultLandingSection(type);
    // A new section goes just above the order form when there is one, so it is seen before ordering.
    const at = sections.findIndex((x) => x.type === "order");
    const next = [...sections];
    next.splice(at >= 0 && type !== "moreProducts" && type !== "reviews" ? at : next.length, 0, s);
    setContent({ sections: next });
    setOpen(s.id);
  }

  async function changeProduct(list: { id: string; name: string }[]) {
    const p = list.at(-1);
    if (!p || p.id === draft.content.productId) return;
    if (!(await confirm(`Sell “${p.name}” on this page instead? The colour and size choices are reset.`, { confirmLabel: "Change product", tone: "default", title: "Change product" }))) return;
    productName.current = p.name;
    setContent({ productId: p.id, variantIds: [], defaultColor: undefined, defaultSize: undefined });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/lp/${meta.slug}`);
      toast.success("Link copied — paste it into the ad");
    } catch {
      toast.error("Couldn't copy — select the link and copy it");
    }
  }

  const live = meta.status === "PUBLISHED";
  const busy = state === "saving" || state === "dirty";
  const present = new Set(sections.map((s) => s.type));
  const addable = (Object.keys(LANDING_SECTION_LABELS) as LandingSectionType[]).filter((t) => !LANDING_SINGLETON_SECTIONS.includes(t) || !present.has(t));

  return (
    <div className="space-y-5 pb-16">
      {dialog}
      <BackLink href="/admin/marketing/landing-pages" label="Landing pages" />

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{draft.name || "Untitled page"}</h1>
            {live ? <Badge variant="success" dot>Live</Badge> : <Badge variant="neutral" dot>Draft</Badge>}
            {live && meta.hasUnpublishedChanges && <Badge variant="warning">Unpublished changes</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span className="font-mono">/lp/{meta.slug}</span>
            <SaveStatus state={state} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {live && (
            <Button variant="outline" size="sm" onClick={() => void copyLink()}>
              <Copy className="h-4 w-4" aria-hidden /> Copy link
            </Button>
          )}
          <a href={`/lp-preview/${meta.id}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[var(--control-radius)] border border-line-strong bg-surface/60 px-3 text-sm font-medium text-fg hover:bg-surface">
            <ExternalLink className="h-4 w-4" aria-hidden /> Preview
          </a>
          <Button variant="outline" size="sm" onClick={() => setDuplicating(true)}>
            Duplicate
          </Button>
          {live ? (
            <Button variant="ghost" size="sm" loading={unpublish.isPending} onClick={async () => { if (await confirm("Take this page off the site? Ads pointing at it will show “not found” until you publish again.", { confirmLabel: "Unpublish", tone: "danger", title: "Unpublish page" })) unpublish.mutate(); }}>
              Unpublish
            </Button>
          ) : (
            <Button variant="ghost" size="sm" loading={remove.isPending} onClick={async () => { if (await confirm(`Delete “${meta.name}”? This can't be undone.`, { confirmLabel: "Delete", tone: "danger", title: "Delete page" })) remove.mutate(); }}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
          )}
          <Button size="sm" onClick={() => publish.mutate()} loading={publish.isPending} disabled={busy || state === "invalid" || state === "error" || (live && !meta.hasUnpublishedChanges)} data-testid="lp-publish">
            {live ? "Publish changes" : "Publish"}
          </Button>
        </div>
      </header>

      {problem && (
        <p role="alert" className="rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {problem}
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="Page">
            <div className="space-y-3">
              <div>
                <Label htmlFor="lp-name" className="text-xs">Name (only you see it)</Label>
                <Input id="lp-name" value={draft.name} maxLength={120} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="lp-slug" className="text-xs">Address</Label>
                <div className="flex items-center rounded-[var(--control-radius)] border border-line bg-surface focus-within:ring-2 focus-within:ring-accent/30">
                  <span className="pl-3 font-mono text-sm text-fg-muted">/lp/</span>
                  <input id="lp-slug" value={draft.slug} onChange={(e) => setDraft((d) => ({ ...d, slug: slugify(e.target.value) }))} className="h-10 min-w-0 flex-1 bg-transparent pr-3 font-mono text-sm text-fg outline-none" />
                </div>
                {live && draft.slug !== initial.slug && <p className="mt-1 text-xs text-fg-muted">The old address will keep working and send visitors here.</p>}
              </div>
            </div>
          </Panel>

          <Panel title="Product & options" description="The page sells this product's own variants, prices and stock.">
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-fg">Product</p>
                <ProductPicker selected={[{ id: draft.content.productId, name: product.data?.product.name ?? productName.current }]} onChange={(list) => void changeProduct(list)} />
              </div>
              {product.isLoading ? (
                <Skeleton className="h-32" />
              ) : product.error ? (
                <p className="text-sm text-danger-700">Couldn&apos;t load the product&apos;s variants.</p>
              ) : product.data ? (
                <VariantChooser
                  variants={product.data.product.variants}
                  value={draft.content.variantIds}
                  onChange={(variantIds) => setContent({ variantIds })}
                  defaultColor={draft.content.defaultColor}
                  defaultSize={draft.content.defaultSize}
                  onDefaults={(d) => setContent(d)}
                />
              ) : null}
            </div>
          </Panel>

          <Panel title="Sections" description="Drag to reorder. The order form is required.">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2" data-testid="lp-sections">
                  {sections.map((s) => (
                    <SortableSection
                      key={s.id}
                      section={s}
                      open={open === s.id}
                      onToggleOpen={() => setOpen(open === s.id ? null : s.id)}
                      onChange={setSection}
                      onRemove={s.type === "order" ? undefined : () => setContent({ sections: sections.filter((x) => x.id !== s.id) })}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            <AddSection types={addable} onAdd={addSection} />
          </Panel>

          <Panel title="Design">
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-fg">Headings</p>
                <SegmentedControl
                  aria-label="Heading style"
                  value={draft.content.design.headingFont}
                  onChange={(headingFont) => setContent({ design: { ...draft.content.design, headingFont } })}
                  options={[{ value: "display", label: "Display" }, { value: "sans", label: "Plain" }]}
                />
              </div>
              <ToggleRow label="Order bar at the bottom on phones" checked={draft.content.design.stickyCta} onChange={(stickyCta) => setContent({ design: { ...draft.content.design, stickyCta } })} />
              <ToggleRow label="“Call us” in the header" checked={draft.content.design.headerCall} onChange={(headerCall) => setContent({ design: { ...draft.content.design, headerCall } })} />
            </div>
          </Panel>

          <Panel title="Sharing" description="What a link preview on Facebook or WhatsApp shows. Empty uses the product's.">
            <div className="space-y-3">
              <div>
                <Label htmlFor="lp-seo-title" className="text-xs">Title</Label>
                <Input id="lp-seo-title" value={draft.content.seoTitle ?? ""} maxLength={70} onChange={(e) => setContent({ seoTitle: e.target.value || undefined })} />
              </div>
              <div>
                <Label htmlFor="lp-seo-desc" className="text-xs">Description</Label>
                <Textarea id="lp-seo-desc" rows={2} value={draft.content.seoDescription ?? ""} maxLength={200} onChange={(e) => setContent({ seoDescription: e.target.value || undefined })} />
              </div>
              <ImageUploadField label="Share image" value={draft.content.ogImageUrl} onChange={(url) => setContent({ ogImageUrl: url || undefined })} upload={api.uploadLandingImage} />
            </div>
          </Panel>
        </div>

        <div className="hidden lg:sticky lg:top-6 lg:block">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-fg">Preview</p>
            <SegmentedControl
              aria-label="Preview width"
              value={device}
              onChange={setDevice}
              options={[
                { value: "phone", label: <Smartphone className="h-4 w-4" aria-hidden />, ariaLabel: "Phone width" },
                { value: "desktop", label: <Monitor className="h-4 w-4" aria-hidden />, ariaLabel: "Desktop width" },
              ]}
            />
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface-muted shadow-sm">
            <div className={cn("mx-auto h-[calc(100vh-10rem)] bg-surface transition-[width] duration-slow ease-smooth", device === "phone" ? "w-[390px] max-w-full" : "w-full")}>
              <iframe key={previewKey} title="Landing page preview" src={`/lp-preview/${meta.id}?v=${previewKey}`} className="h-full w-full" />
            </div>
          </div>
        </div>
      </div>

      {duplicating && <DuplicateDialog page={meta} onClose={() => setDuplicating(false)} />}
    </div>
  );
}

/** A schema issue, said in the editor's words: which section, which field. */
function describeIssue(path: (string | number)[], message: string, content: LandingPageContent) {
  if (path[0] === "sections" && typeof path[1] === "number") {
    const s = content.sections[path[1]];
    const label = s ? LANDING_SECTION_LABELS[s.type].label : "A section";
    const field = path.slice(2).filter((p) => typeof p === "string").join(" ");
    return `${label}: ${field ? `${field} — ` : ""}${message.replace(/^String must contain at least 1 character\(s\)$/, "can't be empty")}`;
  }
  return message;
}

function SaveStatus({ state }: { state: SaveState }) {
  const text = { saved: "All changes saved", dirty: "Editing…", saving: "Saving…", invalid: "Not saved — fix the problem below", error: "Not saved" }[state];
  return (
    <span className={cn("text-xs", state === "invalid" || state === "error" ? "text-danger-700" : "text-fg-muted")} role="status" aria-live="polite">
      {text}
    </span>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-fg">{label}</span>
      <Switch checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

function SortableSection({ section, open, onToggleOpen, onChange, onRemove }: { section: LandingSection; open: boolean; onToggleOpen: () => void; onChange: (s: LandingSection) => void; onRemove?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const meta = LANDING_SECTION_LABELS[section.type];
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("rounded-xl border border-line bg-surface", isDragging && "relative z-10 shadow-float", !section.enabled && "bg-surface-muted")}>
      <div className="flex items-center gap-1 py-1.5 pl-1 pr-2">
        <button type="button" className="flex h-10 w-8 cursor-grab touch-none items-center justify-center text-fg-muted active:cursor-grabbing" aria-label={`Move ${meta.label}`} {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" onClick={onToggleOpen} aria-expanded={open} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left">
          <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", section.enabled ? "text-fg" : "text-fg-muted")}>{meta.label}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-fg-muted transition-transform duration-base", open && "rotate-180")} aria-hidden />
        </button>
        {section.type !== "order" && <Switch checked={section.enabled} onChange={(enabled) => onChange({ ...section, enabled })} aria-label={`Show ${meta.label}`} />}
      </div>
      {open && (
        <div className="border-t border-line-subtle px-4 pb-4 pt-3">
          <p className="mb-3 text-xs text-fg-muted">{meta.hint}</p>
          <SectionFields section={section} onChange={onChange} />
          {onRemove && (
            <Button type="button" variant="ghost" size="sm" className="mt-4 text-danger-700" onClick={onRemove}>
              <Trash2 className="h-4 w-4" aria-hidden /> Remove section
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function AddSection({ types, onAdd }: { types: LandingSectionType[]; onAdd: (t: LandingSectionType) => void }) {
  const [open, setOpen] = useState(false);
  if (!types.length) return null;
  return (
    <div className="mt-3">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Plus className="h-4 w-4" aria-hidden /> Add section
      </Button>
      {open && (
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {types.map((t) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => {
                  onAdd(t);
                  setOpen(false);
                }}
                className="w-full rounded-lg border border-line bg-surface p-2.5 text-left transition-colors duration-base hover:border-line-strong"
              >
                <span className="block text-sm font-medium text-fg">{LANDING_SECTION_LABELS[t].label}</span>
                <span className="block text-xs leading-snug text-fg-muted">{LANDING_SECTION_LABELS[t].hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DuplicateDialog({ page, onClose }: { page: LandingPageDetail; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(`${page.name} (copy)`);
  const [slug, setSlug] = useState(slugify(`${page.slug}-2`));
  const [error, setError] = useState<string | null>(null);
  const dup = useMutation({
    mutationFn: () => api.duplicateLandingPage(page.id, { name: name.trim(), slug }),
    onSuccess: ({ page: copy }) => {
      toast.success("Copy created as a draft");
      onClose();
      router.push(`/admin/marketing/landing-pages/${copy.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't duplicate — try again"),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Duplicate page"
      description="Same product, sections and copy, at a new address — for the next campaign."
      widthClassName="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => dup.mutate()} loading={dup.isPending} disabled={!name.trim() || !slug}>Duplicate</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="dup-name" className="text-xs">Name</Label>
          <Input id="dup-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="dup-slug" className="text-xs">Address</Label>
          <Input id="dup-slug" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} className="font-mono" />
          <p className="mt-1 text-xs text-fg-muted">/lp/{slug}</p>
        </div>
        {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
      </div>
    </Modal>
  );
}
