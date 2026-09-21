"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LayoutList, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { CatalogSubNav } from "@/components/admin/catalog-subnav";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { useCanManageCatalog } from "@/hooks/use-can-manage-catalog";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";

export default function SpecGroupsPage() {
  const queryClient = useQueryClient();
  const canManage = useCanManageCatalog();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data, isLoading } = useQuery({ queryKey: ["catalog-spec-groups"], queryFn: catalogApi.listSpecGroups });
  const groups = data?.specGroups ?? [];

  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["catalog-spec-groups"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-templates"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-types"] });
  }

  const createMutation = useMutation({
    mutationFn: () => catalogApi.createSpecGroup({ name: newName, sortOrder: groups.length }),
    onSuccess: () => {
      refresh();
      setNewName("");
      toast.success("Spec group added");
    },
    onError: (err) => toast.error(describeApiError(err, "Failed to add spec group")),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => catalogApi.updateSpecGroup(id, { name }),
    onSuccess: () => {
      refresh();
      setRenaming(null);
      toast.success("Spec group renamed");
    },
    onError: (err) => toast.error(describeApiError(err, "Failed to rename spec group")),
  });

  async function handleDelete(g: catalogApi.SpecGroupRow) {
    const note = g.usageCount > 0 ? ` ${g.usageCount} attribute${g.usageCount === 1 ? "" : "s"} in templates will move to "Specifications".` : "";
    if (!(await confirm(`Delete the "${g.name}" spec group?${note}`))) return;
    try {
      await catalogApi.deleteSpecGroup(g.id);
      refresh();
      toast.success("Spec group deleted");
    } catch (err) {
      toast.error(describeApiError(err, "Failed to delete spec group"));
    }
  }

  return (
    <div>
      <PageHeader title="Catalog setup" description="Define what kinds of products the store sells, and what each kind collects and shows." />
      <CatalogSubNav />

      <p className="mb-4 text-sm text-ink-500">
        A spec group is a titled block on the product page (&ldquo;Watch Details&rdquo;, &ldquo;Warranty &amp; Support&rdquo;). In a template you
        choose which attributes appear in which group.
      </p>

      {canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) createMutation.mutate();
          }}
          className="mb-4 flex max-w-md gap-2"
        >
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New spec group name" aria-label="New spec group name" />
          <Button type="submit" variant="brass" disabled={!newName.trim() || createMutation.isPending}>
            <Plus size={16} /> Add
          </Button>
        </form>
      )}

      <div className="max-w-2xl overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        {isLoading && <p className="p-4 text-sm text-ink-400">Loading…</p>}
        {!isLoading && groups.length === 0 && <EmptyState icon={LayoutList} title="No spec groups yet" description="Add one, then assign template attributes to it." />}
        {groups.map((g) => (
          <div key={g.id} className={cn("flex items-center justify-between gap-3 border-t border-ink-100 px-4 py-3 first:border-t-0")}>
            {renaming?.id === g.id ? (
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (renaming.name.trim()) renameMutation.mutate(renaming);
                }}
              >
                <Input value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} autoFocus aria-label="Spec group name" />
                <button type="submit" className={cn(ICON_BUTTON_HIT, "text-success-600")} aria-label="Save name">
                  <Check size={16} />
                </button>
                <button type="button" onClick={() => setRenaming(null)} className={cn(ICON_BUTTON_HIT, "text-ink-500")} aria-label="Cancel">
                  <X size={16} />
                </button>
              </form>
            ) : (
              <>
                <div>
                  <span className="font-medium text-ink-900">{g.name}</span>
                  <span className="ml-2 text-xs text-ink-400">
                    {g.usageCount} attribute{g.usageCount === 1 ? "" : "s"}
                  </span>
                </div>
                {canManage && (
                  <div className="flex gap-3">
                    <button onClick={() => setRenaming({ id: g.id, name: g.name })} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label={`Rename ${g.name}`}>
                      <Pencil size={16} />
                    </button>
                    <button onClick={() => handleDelete(g)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")} aria-label={`Delete ${g.name}`}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {!canManage && <p className="mt-3 text-xs text-ink-400">Only the store owner can change catalog setup.</p>}
      {confirmDialog}
    </div>
  );
}
