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
import { EmptyState } from "@/components/admin/empty-state";
import { ListPage } from "@/components/admin/patterns/list-page";
import { DataTable, type DataTableColumn } from "@/components/admin/data-table";
import { useCanManageCatalog } from "@/hooks/use-can-manage-catalog";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

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
  const { data, isLoading, error: loadError, refetch } = useQuery({ queryKey: ["catalog-attributes"], queryFn: catalogApi.listAttributeDefinitions });
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
    onError: (err) => setError(describeApiError(err, "Couldn't save the field")),
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
    if (!(await confirm(`Delete the "${attr.label}" field? This cannot be undone.`))) return;
    try {
      await catalogApi.deleteAttributeDefinition(attr.id);
      refresh();
      toast.success("Attribute deleted");
    } catch (err) {
      toast.error(describeApiError(err, "Couldn't delete the field"));
    }
  }

  const isNew = editing === "new";

  const columns: DataTableColumn<catalogApi.AttributeDefinitionRow>[] = [
      {
        id: "label",
        header: "Field",
        card: "title",
        cell: (a) => (
          <div className="min-w-0">
            <div className={cn("font-medium text-ink-900", a.isArchived && "text-ink-500")}>
              {a.label} {a.isArchived && <Badge>Archived</Badge>}
            </div>
            <div className="text-xs text-ink-400">{a.key}</div>
          </div>
        ),
      },
      {
        id: "type",
        header: "Type",
        cell: (a) => (
          <span className="text-ink-600">
            {ATTRIBUTE_DATA_TYPE_LABELS[a.dataType]}
            {a.unit && <span className="text-ink-400"> · {a.unit}</span>}
          </span>
        ),
      },
      {
        id: "options",
        header: "Options",
        card: "hidden",
        cell: (a) => (
          <div className="flex flex-wrap gap-1">
            {a.options.slice(0, 5).map((o) => (
              <Badge key={o.id}>{o.value}</Badge>
            ))}
            {a.options.length > 5 && <span className="text-xs text-ink-400">+{a.options.length - 5}</span>}
            {a.options.length === 0 && <span className="text-ink-300">—</span>}
          </div>
        ),
      },
      {
        id: "used",
        header: "Used",
        cell: (a) => (
          <span className="text-ink-500">
            {a.templateCount} template{a.templateCount === 1 ? "" : "s"} · {a.valueCount} value{a.valueCount === 1 ? "" : "s"}
          </span>
        ),
      },
    ];
  const rowActions = (row: catalogApi.AttributeDefinitionRow) => [
    { label: "Edit", icon: Pencil, onSelect: () => openEditor(row) },
    { label: "Delete", icon: Trash2, destructive: true, onSelect: () => handleDelete(row) },
  ];

  return (
    <ListPage
      title="Product fields"
      action={
        canManage && (
          <Button variant="brass" onClick={() => openEditor("new")}>
            <Plus size={16} /> Add field
          </Button>
        )
      }
      intro={
        <>
          Product fields are what a product collects — Material, Fit, Movement, Embroidery Type. Add them to a template to
          make them appear for a product type. (Color and size variant options are managed under Products → Variant options.)
        </>
      }
      footnote={!canManage && "Only the store owner can change catalog setup."}
    >
      <DataTable<catalogApi.AttributeDefinitionRow>
        caption="Product fields"
        columns={columns}
        rows={isLoading ? undefined : attributes}
        getRowId={(row) => row.id}
        loading={isLoading}
        error={loadError}
        onRetry={() => void refetch()}
        empty={<EmptyState icon={ListChecks} title="No product fields yet" description="Add fields like Material or Fit, then attach them to a template." variant="bordered" />}
        density="dense"
        onRowOpen={canManage ? openEditor : undefined}
        rowActions={canManage ? rowActions : undefined}
      />

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={isNew ? "Add field" : `Edit ${editing ? editing.label : ""}`} widthClassName="max-w-lg">
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
    </ListPage>
  );
}
