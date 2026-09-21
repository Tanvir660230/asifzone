"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import {
  ATTRIBUTE_DATA_TYPES,
  ATTRIBUTE_DATA_TYPE_LABELS,
  attributeTypeHasOptions,
  attributeTypeHasUnit,
  type AttributeDataType,
} from "@clothing-brand/shared";
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
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { useCanManageCatalog } from "@/hooks/use-can-manage-catalog";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";

interface Draft {
  key: string;
  label: string;
  dataType: AttributeDataType;
  unit: string;
  placeholder: string;
  helpText: string;
  optionsText: string;
  isArchived: boolean;
}

const EMPTY: Draft = { key: "", label: "", dataType: "TEXT", unit: "", placeholder: "", helpText: "", optionsText: "", isArchived: false };

/** "Embroidery Type" -> "embroideryType": the key values are stored under, suggested from the label. */
function suggestKey(label: string) {
  const words = label.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join("");
}

const parseOptions = (text: string) => text.split("\n").map((o) => o.trim()).filter(Boolean);

export default function AttributesCatalogPage() {
  const queryClient = useQueryClient();
  const canManage = useCanManageCatalog();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data, isLoading } = useQuery({ queryKey: ["catalog-attributes"], queryFn: catalogApi.listAttributeDefinitions });
  const attributes = data?.attributes ?? [];

  const [editing, setEditing] = useState<catalogApi.AttributeDefinitionRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [keyTouched, setKeyTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["catalog-attributes"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-types"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-templates"] });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const options = attributeTypeHasOptions(draft.dataType) ? parseOptions(draft.optionsText) : [];
      const shared = { label: draft.label, unit: draft.unit, placeholder: draft.placeholder, helpText: draft.helpText };
      if (editing && editing !== "new") {
        return catalogApi.updateAttributeDefinition(editing.id, {
          ...shared,
          isArchived: draft.isArchived,
          ...(attributeTypeHasOptions(editing.dataType) ? { options } : {}),
        });
      }
      return catalogApi.createAttributeDefinition({ ...shared, key: draft.key, dataType: draft.dataType, options });
    },
    onSuccess: () => {
      refresh();
      toast.success(editing === "new" ? "Attribute created" : "Attribute saved");
      setEditing(null);
    },
    onError: (err) => setError(describeApiError(err, "Failed to save attribute")),
  });

  function openEditor(target: catalogApi.AttributeDefinitionRow | "new") {
    setError(null);
    setEditing(target);
    setKeyTouched(target !== "new");
    setDraft(
      target === "new"
        ? EMPTY
        : {
            key: target.key,
            label: target.label,
            dataType: target.dataType,
            unit: target.unit ?? "",
            placeholder: target.placeholder ?? "",
            helpText: target.helpText ?? "",
            optionsText: target.options.map((o) => o.value).join("\n"),
            isArchived: target.isArchived,
          },
    );
  }

  async function handleDelete(attr: catalogApi.AttributeDefinitionRow) {
    if (!(await confirm(`Delete the "${attr.label}" attribute? This cannot be undone.`))) return;
    try {
      await catalogApi.deleteAttributeDefinition(attr.id);
      refresh();
      toast.success("Attribute deleted");
    } catch (err) {
      toast.error(describeApiError(err, "Failed to delete attribute"));
    }
  }

  const isNew = editing === "new";

  return (
    <div>
      <PageHeader
        title="Catalog setup"
        description="Define what kinds of products the store sells, and what each kind collects and shows."
        action={
          canManage && (
            <Button variant="brass" onClick={() => openEditor("new")}>
              <Plus size={16} /> Add attribute
            </Button>
          )
        }
      />
      <CatalogSubNav />

      <p className="mb-4 text-sm text-ink-500">
        Attributes are the fields a product collects — Material, Fit, Movement, Embroidery Type. Add them to a template to
        make them appear for a product type. (Color and size variant options are managed under Products → Variant options.)
      </p>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Attribute</th>
              <th className="px-4 py-3">Type</th>
              <th className="hidden px-4 py-3 md:table-cell">Options</th>
              <th className="px-4 py-3">Used</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={5} cols={canManage ? 5 : 4} />}
            {!isLoading && attributes.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState icon={ListChecks} title="No attributes yet" description="Add fields like Material or Fit, then attach them to a template." />
                </td>
              </tr>
            )}
            {attributes.map((a) => (
              <tr key={a.id} className={cn("border-t border-ink-100 hover:bg-ink-50/60", a.isArchived && "opacity-60")}>
                <td className="px-4 py-3">
                  <div className="font-medium text-ink-900">
                    {a.label} {a.isArchived && <Badge>Archived</Badge>}
                  </div>
                  <div className="text-xs text-ink-400">{a.key}</div>
                </td>
                <td className="px-4 py-3 text-ink-600">
                  {ATTRIBUTE_DATA_TYPE_LABELS[a.dataType]}
                  {a.unit && <span className="text-ink-400"> · {a.unit}</span>}
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {a.options.slice(0, 5).map((o) => (
                      <Badge key={o.id}>{o.value}</Badge>
                    ))}
                    {a.options.length > 5 && <span className="text-xs text-ink-400">+{a.options.length - 5}</span>}
                    {a.options.length === 0 && <span className="text-ink-300">—</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-ink-500">
                  {a.templateCount} template{a.templateCount === 1 ? "" : "s"} · {a.valueCount} value{a.valueCount === 1 ? "" : "s"}
                </td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      <button onClick={() => openEditor(a)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label={`Edit ${a.label}`}>
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleDelete(a)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")} aria-label={`Delete ${a.label}`}>
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

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={isNew ? "Add attribute" : `Edit ${editing ? editing.label : ""}`} widthClassName="max-w-lg">
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            saveMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="attr-label">Label</Label>
            <Input
              id="attr-label"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value, key: isNew && !keyTouched ? suggestKey(e.target.value) : draft.key })}
              placeholder="e.g. Embroidery Type"
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="attr-key">Key</Label>
              <Input
                id="attr-key"
                value={draft.key}
                disabled={!isNew}
                onChange={(e) => {
                  setKeyTouched(true);
                  setDraft({ ...draft, key: e.target.value });
                }}
                placeholder="embroideryType"
                required
              />
              <p className="mt-1 text-xs text-ink-400">{isNew ? "Can't be changed later." : "Fixed once created."}</p>
            </div>
            <div>
              <Label htmlFor="attr-type">Field type</Label>
              <Select id="attr-type" value={draft.dataType} disabled={!isNew} onChange={(e) => setDraft({ ...draft, dataType: e.target.value as AttributeDataType })}>
                {ATTRIBUTE_DATA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ATTRIBUTE_DATA_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {attributeTypeHasOptions(draft.dataType) && (
            <div>
              <Label htmlFor="attr-options">Options (one per line)</Label>
              <Textarea id="attr-options" rows={5} value={draft.optionsText} onChange={(e) => setDraft({ ...draft, optionsText: e.target.value })} placeholder={"Hand Embroidery\nMachine Embroidery\nNone"} />
              {!isNew && <p className="mt-1 text-xs text-ink-400">An option that products already use can&rsquo;t be removed.</p>}
            </div>
          )}
          {attributeTypeHasUnit(draft.dataType) && (
            <div>
              <Label htmlFor="attr-unit">Unit</Label>
              <Input id="attr-unit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="cm, ATM, g…" />
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="attr-placeholder">Placeholder</Label>
              <Input id="attr-placeholder" value={draft.placeholder} onChange={(e) => setDraft({ ...draft, placeholder: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="attr-help">Help text</Label>
              <Input id="attr-help" value={draft.helpText} onChange={(e) => setDraft({ ...draft, helpText: e.target.value })} />
            </div>
          </div>
          {!isNew && (
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <Checkbox checked={draft.isArchived} onChange={(e) => setDraft({ ...draft, isArchived: e.target.checked })} />
              Archived — hidden from products and can&rsquo;t be added to templates (saved values are kept)
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="brass" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
