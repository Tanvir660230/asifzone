"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers3, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
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
  isArchived: boolean;
}

export default function MaterialsPage() {
  const queryClient = useQueryClient();
  const canManage = useCanManageCatalog();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data, isLoading } = useQuery({ queryKey: ["catalog-materials"], queryFn: catalogApi.listMaterials });
  const materials = data?.materials ?? [];

  const [editing, setEditing] = useState<catalogApi.MaterialRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", description: "", isArchived: false });
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["catalog-materials"] });

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = { name: draft.name, description: draft.description };
      return editing && editing !== "new" ? catalogApi.updateMaterial(editing.id, { ...input, isArchived: draft.isArchived }) : catalogApi.createMaterial(input);
    },
    onSuccess: () => {
      refresh();
      toast.success(editing === "new" ? "Material created" : "Material saved");
      setEditing(null);
    },
    onError: (err) => setError(describeApiError(err, "Failed to save material")),
  });

  function openEditor(target: catalogApi.MaterialRow | "new") {
    setError(null);
    setEditing(target);
    setDraft(target === "new" ? { name: "", description: "", isArchived: false } : { name: target.name, description: target.description ?? "", isArchived: target.isArchived });
  }

  async function handleDelete(m: catalogApi.MaterialRow) {
    if (!(await confirm(`Delete the "${m.name}" material? This cannot be undone.`))) return;
    try {
      await catalogApi.deleteMaterial(m.id);
      refresh();
      toast.success("Material deleted");
    } catch (err) {
      toast.error(describeApiError(err, "Failed to delete material"));
    }
  }

  return (
    <div>
      <PageHeader
        title="Catalog setup"
        description="Define what kinds of products the store sells, and what each kind collects and shows."
        action={
          canManage && (
            <Button variant="brass" onClick={() => openEditor("new")}>
              <Plus size={16} /> Add material
            </Button>
          )
        }
      />
      <CatalogSubNav />

      <p className="mb-4 text-sm text-ink-500">
        Materials products can be made of (&ldquo;Premium Cotton&rdquo;, &ldquo;Genuine Leather&rdquo;). On a product you combine them with
        percentages — 80% Cotton, 20% Polyester — or type a one-off custom material.
      </p>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">Material</th>
              <th className="hidden px-4 py-3 sm:table-cell">Description</th>
              <th className="px-4 py-3">Products</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={4} cols={canManage ? 4 : 3} />}
            {!isLoading && materials.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState icon={Layers3} title="No materials yet" description="Add the materials your products are made from." />
                </td>
              </tr>
            )}
            {materials.map((m) => (
              <tr key={m.id} className={cn("border-t border-ink-100 hover:bg-ink-50/60", m.isArchived && "opacity-60")}>
                <td className="px-4 py-3 font-medium text-ink-900">
                  {m.name} {m.isArchived && <Badge>Archived</Badge>}
                </td>
                <td className="hidden px-4 py-3 text-ink-500 sm:table-cell">{m.description ?? "—"}</td>
                <td className="px-4 py-3 text-ink-600">{m.productCount}</td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      <button onClick={() => openEditor(m)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label={`Edit ${m.name}`}>
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleDelete(m)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")} aria-label={`Delete ${m.name}`}>
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

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add material" : `Edit ${editing ? editing.name : ""}`} widthClassName="max-w-md">
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
            <Label htmlFor="mat-name">Name</Label>
            <Input id="mat-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Premium Cotton" required />
          </div>
          <div>
            <Label htmlFor="mat-desc">Description</Label>
            <Input id="mat-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
          {editing !== "new" && (
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <Checkbox checked={draft.isArchived} onChange={(e) => setDraft({ ...draft, isArchived: e.target.checked })} />
              Archived — can&rsquo;t be added to more products (existing products keep it)
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
