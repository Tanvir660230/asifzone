"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
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
  name: string;
  description: string;
  templateId: string;
  parentId: string;
  sortOrder: number;
  isActive: boolean;
}

const EMPTY: Draft = { name: "", description: "", templateId: "", parentId: "", sortOrder: 0, isActive: true };

export default function ProductTypesPage() {
  const queryClient = useQueryClient();
  const canManage = useCanManageCatalog();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data, isLoading } = useQuery({ queryKey: ["catalog-types", "manage"], queryFn: catalogApi.listManagedTypes });
  const { data: templatesData } = useQuery({ queryKey: ["catalog-templates"], queryFn: catalogApi.listTemplates });
  const types = data?.types ?? [];
  const templates = (templatesData?.templates ?? []).filter((t) => !t.isArchived);

  const [editing, setEditing] = useState<catalogApi.ManagedType | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["catalog-types"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = {
        name: draft.name,
        description: draft.description,
        templateId: draft.templateId,
        parentId: draft.parentId,
        sortOrder: draft.sortOrder,
        isActive: draft.isActive,
      };
      return editing && editing !== "new" ? catalogApi.updateType(editing.id, input) : catalogApi.createType(input);
    },
    onSuccess: () => {
      refresh();
      toast.success(editing === "new" ? "Product type created" : "Product type saved");
      setEditing(null);
    },
    onError: (err) => setError(describeApiError(err, "Failed to save product type")),
  });

  function openEditor(target: catalogApi.ManagedType | "new") {
    setError(null);
    setEditing(target);
    setDraft(
      target === "new"
        ? { ...EMPTY, templateId: templates[0]?.id ?? "" }
        : {
            name: target.name,
            description: target.description ?? "",
            templateId: target.templateId,
            parentId: target.parentId ?? "",
            sortOrder: target.sortOrder,
            isActive: target.isActive,
          },
    );
  }

  async function handleDelete(type: catalogApi.ManagedType) {
    if (!(await confirm(`Delete the "${type.name}" product type? This cannot be undone.`))) return;
    try {
      await catalogApi.deleteType(type.id);
      refresh();
      toast.success("Product type deleted");
    } catch (err) {
      toast.error(describeApiError(err, "Failed to delete product type"));
    }
  }

  const parentOptions = types.filter((t) => editing === "new" || (editing && t.id !== editing.id));

  return (
    <div>
      <PageHeader
        title="Catalog setup"
        description="Define what kinds of products the store sells, and what each kind collects and shows."
        action={
          canManage && (
            <Button variant="brass" onClick={() => openEditor("new")} disabled={templates.length === 0}>
              <Plus size={16} /> Add product type
            </Button>
          )
        }
      />
      <CatalogSubNav />

      <p className="mb-4 text-sm text-ink-500">
        A product type (Panjabi, Watch, Cap…) points at a <strong>template</strong> that decides its fields, size guide and
        variant options. New types appear in the product editor immediately — no developer needed.
      </p>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="hidden px-4 py-3 sm:table-cell">Template</th>
              <th className="px-4 py-3">Products</th>
              <th className="px-4 py-3">Status</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={4} cols={canManage ? 5 : 4} />}
            {!isLoading && types.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState icon={Layers} title="No product types yet" description="Add your first type to start creating products." />
                </td>
              </tr>
            )}
            {types.map((t) => (
              <tr key={t.id} className="border-t border-ink-100 hover:bg-ink-50/60">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink-900">{t.name}</div>
                  <div className="text-xs text-ink-400">
                    {t.key}
                    {t.parentId && ` · in ${types.find((p) => p.id === t.parentId)?.name ?? "…"}`}
                  </div>
                </td>
                <td className="hidden px-4 py-3 text-ink-600 sm:table-cell">{t.template.name}</td>
                <td className="px-4 py-3 text-ink-600">{t.productCount}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge className={cn(t.isActive && "bg-success-100 text-success-700")}>{t.isActive ? "Active" : "Archived"}</Badge>
                    {t.isSystem && <Badge>Built-in</Badge>}
                  </div>
                </td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      <button onClick={() => openEditor(t)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label={`Edit ${t.name}`}>
                        <Pencil size={16} />
                      </button>
                      {!t.isSystem && (
                        <button onClick={() => handleDelete(t)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")} aria-label={`Delete ${t.name}`}>
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!canManage && <p className="mt-3 text-xs text-ink-400">Only the store owner can change catalog setup.</p>}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add product type" : `Edit ${editing ? editing.name : ""}`} widthClassName="max-w-lg">
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
            <Label htmlFor="type-name">Name</Label>
            <Input id="type-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Panjabi, Watch, Cap" required />
          </div>
          <div>
            <Label htmlFor="type-desc">Description</Label>
            <Textarea id="type-desc" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Shown to admins when choosing a type" />
          </div>
          <div>
            <Label htmlFor="type-template">Template</Label>
            <Select id="type-template" value={draft.templateId} onChange={(e) => setDraft({ ...draft, templateId: e.target.value })} required>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-ink-400">The template decides which fields, size guide and variant options products of this type have.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="type-parent">Family (optional)</Label>
              <Select id="type-parent" value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}>
                <option value="">None</option>
                {parentOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="type-sort">Sort order</Label>
              <Input id="type-sort" type="number" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Checkbox checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
            Active — offered when creating products (archived types keep their existing products)
          </label>
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
