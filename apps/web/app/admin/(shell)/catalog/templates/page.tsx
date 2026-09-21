"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, LayoutTemplate, Pencil, Plus, Trash2, X } from "lucide-react";
import { SectionSettingsEditor, layerOf } from "@/components/admin/section-settings-editor";
import { ATTRIBUTE_DATA_TYPE_LABELS, COMPLETENESS_CHECKS, OPTIONAL_COMPLETENESS_KEYS, type SectionOverrideInput, type SizeGuideMode, type VariantDimension } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { CatalogSubNav } from "@/components/admin/catalog-subnav";
import { EmptyState } from "@/components/admin/empty-state";
import { FormSection } from "@/components/admin/form-section";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { useCanManageCatalog } from "@/hooks/use-can-manage-catalog";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";

interface DimensionDraft {
  enabled: boolean;
  label: string;
  optionsText: string;
}
interface AttributeDraft {
  definitionId: string;
  required: boolean;
  specGroupId: string;
  placeholder: string;
  showOnStorefront: boolean;
}
interface Draft {
  name: string;
  description: string;
  size: DimensionDraft;
  color: DimensionDraft;
  sizeGuideMode: SizeGuideMode;
  sizeGuidePresetId: string;
  carePresetId: string;
  requiredChecks: string[];
  sections: SectionOverrideInput[];
  attributes: AttributeDraft[];
  isArchived: boolean;
}

const EMPTY: Draft = {
  name: "",
  description: "",
  size: { enabled: false, label: "Size", optionsText: "" },
  color: { enabled: false, label: "Color", optionsText: "" },
  sizeGuideMode: "NOT_APPLICABLE",
  sizeGuidePresetId: "",
  carePresetId: "",
  requiredChecks: [],
  sections: [],
  attributes: [],
  isArchived: false,
};

const SIZE_GUIDE_MODE_LABELS: Record<SizeGuideMode, string> = {
  NOT_APPLICABLE: "No size guide",
  OFF_BY_DEFAULT: "Available, off by default",
  ON_BY_DEFAULT: "On by default",
};

const optionsToText = (o: string[]) => o.join(", ");
const textToOptions = (t: string) => t.split(",").map((x) => x.trim()).filter(Boolean);

function toDimensions(draft: Draft): VariantDimension[] {
  const dims: VariantDimension[] = [];
  if (draft.size.enabled) dims.push({ targetField: "size", label: draft.size.label, options: textToOptions(draft.size.optionsText) });
  if (draft.color.enabled) dims.push({ targetField: "color", label: draft.color.label, options: textToOptions(draft.color.optionsText) });
  return dims;
}

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const canManage = useCanManageCatalog();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data, isLoading } = useQuery({ queryKey: ["catalog-templates"], queryFn: catalogApi.listTemplates });
  const { data: defsData } = useQuery({ queryKey: ["catalog-attributes"], queryFn: catalogApi.listAttributeDefinitions });
  const { data: groupsData } = useQuery({ queryKey: ["catalog-spec-groups"], queryFn: catalogApi.listSpecGroups });
  const { data: guidesData } = useQuery({ queryKey: ["catalog-size-guides"], queryFn: catalogApi.listSizeGuides });
  const { data: careData } = useQuery({ queryKey: ["catalog-care-guides"], queryFn: catalogApi.listCareGuides });
  const { data: globalSectionsData } = useQuery({ queryKey: ["catalog-sections"], queryFn: catalogApi.getGlobalSections });
  const templates = data?.templates ?? [];
  const definitions = defsData?.attributes ?? [];
  const specGroups = groupsData?.specGroups ?? [];
  const guides = guidesData?.sizeGuides ?? [];
  const careGuides = careData?.careGuides ?? [];
  const defById = new Map(definitions.map((d) => [d.id, d]));

  const [editing, setEditing] = useState<catalogApi.TemplateRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [toAdd, setToAdd] = useState("");
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["catalog-templates"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-types"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-attributes"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = {
        name: draft.name,
        description: draft.description,
        variantDimensions: toDimensions(draft),
        sizeGuideMode: draft.sizeGuideMode,
        sizeGuidePresetId: draft.sizeGuideMode === "NOT_APPLICABLE" ? "" : draft.sizeGuidePresetId,
        carePresetId: draft.carePresetId,
        requiredChecks: draft.requiredChecks,
        sections: draft.sections,
        attributes: draft.attributes,
        isArchived: draft.isArchived,
      };
      return editing && editing !== "new" ? catalogApi.updateTemplate(editing.id, input) : catalogApi.createTemplate(input);
    },
    onSuccess: () => {
      refresh();
      toast.success(editing === "new" ? "Template created" : "Template saved");
      setEditing(null);
    },
    onError: (err) => setError(describeApiError(err, "Failed to save template")),
  });

  function openEditor(target: catalogApi.TemplateRow | "new") {
    setError(null);
    setToAdd("");
    setEditing(target);
    if (target === "new") return setDraft(EMPTY);
    const size = target.variantDimensions.find((d) => d.targetField === "size");
    const color = target.variantDimensions.find((d) => d.targetField === "color");
    setDraft({
      name: target.name,
      description: target.description ?? "",
      size: { enabled: Boolean(size), label: size?.label ?? "Size", optionsText: optionsToText(size?.options ?? []) },
      color: { enabled: Boolean(color), label: color?.label ?? "Color", optionsText: optionsToText(color?.options ?? []) },
      sizeGuideMode: target.sizeGuideMode,
      sizeGuidePresetId: target.sizeGuidePresetId ?? "",
      carePresetId: target.carePresetId ?? "",
      requiredChecks: target.requiredChecks,
      sections: target.sections as SectionOverrideInput[],
      attributes: target.attributes.map((a) => ({
        definitionId: a.definitionId,
        required: a.required,
        specGroupId: a.specGroupId ?? "",
        placeholder: a.placeholder ?? "",
        showOnStorefront: a.showOnStorefront,
      })),
      isArchived: target.isArchived,
    });
  }

  async function handleDelete(t: catalogApi.TemplateRow) {
    if (!(await confirm(`Delete the "${t.name}" template? This cannot be undone.`))) return;
    try {
      await catalogApi.deleteTemplate(t.id);
      refresh();
      toast.success("Template deleted");
    } catch (err) {
      toast.error(describeApiError(err, "Failed to delete template"));
    }
  }

  const patchAttr = (i: number, patch: Partial<AttributeDraft>) =>
    setDraft((d) => ({ ...d, attributes: d.attributes.map((a, ai) => (ai === i ? { ...a, ...patch } : a)) }));
  const moveAttr = (i: number, delta: number) =>
    setDraft((d) => {
      const next = [...d.attributes];
      const j = i + delta;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return { ...d, attributes: next };
    });

  const usedIds = new Set(draft.attributes.map((a) => a.definitionId));
  const addable = definitions.filter((d) => !d.isArchived && !usedIds.has(d.id));
  const usableGuides = guides.filter((g) => !g.isArchived || g.id === draft.sizeGuidePresetId);
  const usableCare = careGuides.filter((g) => !g.isArchived || g.id === draft.carePresetId);

  function DimensionEditor({ title, dim, onChange }: { title: string; dim: DimensionDraft; onChange: (d: DimensionDraft) => void }) {
    return (
      <div className="rounded-lg border border-ink-100 p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-ink-800">
          <Checkbox checked={dim.enabled} onChange={(e) => onChange({ ...dim, enabled: e.target.checked })} />
          {title}
        </label>
        {dim.enabled && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-[11px]">Label shown to customers</Label>
              <Input value={dim.label} onChange={(e) => onChange({ ...dim, label: e.target.value })} aria-label={`${title} label`} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[11px]">Suggested values (comma-separated)</Label>
              <Input value={dim.optionsText} onChange={(e) => onChange({ ...dim, optionsText: e.target.value })} placeholder="S, M, L, XL" aria-label={`${title} values`} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Catalog setup"
        description="Define what kinds of products the store sells, and what each kind collects and shows."
        action={
          canManage && (
            <Button variant="brass" onClick={() => openEditor("new")}>
              <Plus size={16} /> Add template
            </Button>
          )
        }
      />
      <CatalogSubNav />

      <p className="mb-4 text-sm text-ink-500">
        A template bundles what a product type collects: which attributes, whether variants have a size and/or colour, and which size
        guide applies. Several product types can share one template.
      </p>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Template</th>
              <th className="hidden px-4 py-3 md:table-cell">Variants</th>
              <th className="hidden px-4 py-3 sm:table-cell">Attributes</th>
              <th className="px-4 py-3">Types</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={4} cols={canManage ? 5 : 4} />}
            {!isLoading && templates.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState icon={LayoutTemplate} title="No templates yet" description="Create one, then point a product type at it." />
                </td>
              </tr>
            )}
            {templates.map((t) => (
              <tr key={t.id} className={cn("border-t border-ink-100 hover:bg-ink-50/60", t.isArchived && "opacity-60")}>
                <td className="px-4 py-3">
                  <div className="font-medium text-ink-900">
                    {t.name} {t.isArchived && <Badge>Archived</Badge>}
                  </div>
                  <div className="text-xs text-ink-400">{SIZE_GUIDE_MODE_LABELS[t.sizeGuideMode]}{t.sizeGuidePreset ? ` · ${t.sizeGuidePreset.name}` : ""}</div>
                </td>
                <td className="hidden px-4 py-3 text-ink-600 md:table-cell">{t.variantDimensions.map((d) => d.label).join(" × ") || "—"}</td>
                <td className="hidden px-4 py-3 text-ink-600 sm:table-cell">{t.attributes.length}</td>
                <td className="px-4 py-3 text-ink-600">{t.typeCount}</td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      <button onClick={() => openEditor(t)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label={`Edit ${t.name}`}>
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleDelete(t)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")} aria-label={`Delete ${t.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!canManage && <p className="mt-3 text-xs text-ink-400">Only the store owner can change catalog setup.</p>}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add template" : `Edit ${editing ? editing.name : ""}`} widthClassName="max-w-3xl">
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            saveMutation.mutate();
          }}
          className="space-y-6"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Cap template" required />
            </div>
            <div>
              <Label htmlFor="tpl-desc">Description</Label>
              <Textarea id="tpl-desc" rows={1} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
          </div>

          <FormSection title="Variant options" description="What a shopper picks before adding to cart. Leave both off for one-size products.">
            <div className="space-y-3">
              <DimensionEditor title="Has a size (or size-like) choice" dim={draft.size} onChange={(size) => setDraft({ ...draft, size })} />
              <DimensionEditor title="Has a colour choice" dim={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
            </div>
          </FormSection>

          <FormSection title="Size guide">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="tpl-sg-mode">Behaviour</Label>
                <Select id="tpl-sg-mode" value={draft.sizeGuideMode} onChange={(e) => setDraft({ ...draft, sizeGuideMode: e.target.value as SizeGuideMode })}>
                  {(Object.keys(SIZE_GUIDE_MODE_LABELS) as SizeGuideMode[]).map((m) => (
                    <option key={m} value={m}>
                      {SIZE_GUIDE_MODE_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </div>
              {draft.sizeGuideMode !== "NOT_APPLICABLE" && (
                <div>
                  <Label htmlFor="tpl-sg-preset">Size guide</Label>
                  <Select id="tpl-sg-preset" value={draft.sizeGuidePresetId} onChange={(e) => setDraft({ ...draft, sizeGuidePresetId: e.target.value })}>
                    <option value="">Generic apparel chart</option>
                    {usableGuides.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                        {g.isArchived ? " (archived)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          </FormSection>

          <FormSection title="Care guide" description="Products of this type show this care guide unless they pick another or write their own.">
            <Select value={draft.carePresetId} onChange={(e) => setDraft({ ...draft, carePresetId: e.target.value })} aria-label="Default care guide">
              <option value="">No default care guide</option>
              {usableCare.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.isArchived ? " (archived)" : ""}
                </option>
              ))}
            </Select>
          </FormSection>

          <FormSection
            title="Required before publishing"
            description="A product can't be marked ready or published until these are complete. Name, category, price, variants, images and required attributes are always required."
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {COMPLETENESS_CHECKS.filter((c) => (OPTIONAL_COMPLETENESS_KEYS as readonly string[]).includes(c.key)).map((c) => (
                <label key={c.key} className="flex items-start gap-2 text-sm text-ink-700">
                  <Checkbox
                    checked={draft.requiredChecks.includes(c.key)}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, requiredChecks: e.target.checked ? [...d.requiredChecks, c.key] : d.requiredChecks.filter((k) => k !== c.key) }))
                    }
                    aria-label={`Require ${c.label}`}
                  />
                  <span>
                    {c.label}
                    <span className="block text-xs text-ink-400">{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </FormSection>

          <FormSection
            title="Page sections"
            description="How the product page is laid out for products of this template. Anything left as Inherit follows the store settings; a product can still override it."
          >
            <SectionSettingsEditor
              level="template"
              base={{ global: layerOf((globalSectionsData?.overrides ?? []) as SectionOverrideInput[]) }}
              value={draft.sections}
              onChange={(sections) => setDraft({ ...draft, sections })}
            />
          </FormSection>

          <FormSection title="Attributes" description="The fields products of this type collect, in display order.">
            {draft.attributes.length === 0 && <p className="text-sm text-ink-400">No attributes yet — add one below.</p>}
            <div className="space-y-2">
              {draft.attributes.map((a, i) => {
                const def = defById.get(a.definitionId);
                return (
                  <div key={a.definitionId} className="rounded-lg border border-ink-100 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-sm font-medium text-ink-900">{def?.label ?? "Unknown attribute"}</span>
                        {def && <span className="ml-2 text-xs text-ink-400">{ATTRIBUTE_DATA_TYPE_LABELS[def.dataType]}</span>}
                        {def?.isArchived && <Badge className="ml-2">Archived</Badge>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => moveAttr(i, -1)} disabled={i === 0} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900 disabled:opacity-30")} aria-label={`Move ${def?.label} up`}>
                          <ArrowUp size={15} />
                        </button>
                        <button type="button" onClick={() => moveAttr(i, 1)} disabled={i === draft.attributes.length - 1} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900 disabled:opacity-30")} aria-label={`Move ${def?.label} down`}>
                          <ArrowDown size={15} />
                        </button>
                        <button type="button" onClick={() => setDraft((d) => ({ ...d, attributes: d.attributes.filter((_, ai) => ai !== i) }))} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")} aria-label={`Remove ${def?.label}`}>
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-[11px]">Shown on product page under</Label>
                        <Select value={a.specGroupId} onChange={(e) => patchAttr(i, { specGroupId: e.target.value })} aria-label={`${def?.label} spec group`}>
                          <option value="">Specifications (default)</option>
                          {specGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px]">Placeholder for this template</Label>
                        <Input value={a.placeholder} onChange={(e) => patchAttr(i, { placeholder: e.target.value })} aria-label={`${def?.label} placeholder`} />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-700">
                      <label className="flex items-center gap-2">
                        <Checkbox checked={a.required} onChange={(e) => patchAttr(i, { required: e.target.checked })} />
                        Required
                      </label>
                      <label className="flex items-center gap-2">
                        <Checkbox checked={a.showOnStorefront} onChange={(e) => patchAttr(i, { showOnStorefront: e.target.checked })} />
                        Show on product page
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Select value={toAdd} onChange={(e) => setToAdd(e.target.value)} aria-label="Attribute to add">
                <option value="">Add an attribute…</option>
                {addable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({ATTRIBUTE_DATA_TYPE_LABELS[d.dataType]})
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={!toAdd}
                onClick={() => {
                  setDraft((d) => ({ ...d, attributes: [...d.attributes, { definitionId: toAdd, required: false, specGroupId: "", placeholder: "", showOnStorefront: true }] }));
                  setToAdd("");
                }}
              >
                <Plus size={16} /> Add
              </Button>
            </div>
          </FormSection>

          {editing !== "new" && (
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <Checkbox checked={draft.isArchived} onChange={(e) => setDraft({ ...draft, isArchived: e.target.checked })} />
              Archived — can&rsquo;t be chosen for new product types
            </label>
          )}

          <div className="flex justify-end gap-2 border-t border-ink-100 pt-4">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="brass" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save template"}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
