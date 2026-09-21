"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Copy, Droplets, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { CatalogSubNav } from "@/components/admin/catalog-subnav";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { useCanManageCatalog } from "@/hooks/use-can-manage-catalog";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";

interface Draft {
  name: string;
  description: string;
  stepsText: string;
}

const parseSteps = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);

export default function CareGuidesPage() {
  const queryClient = useQueryClient();
  const canManage = useCanManageCatalog();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data, isLoading } = useQuery({ queryKey: ["catalog-care-guides"], queryFn: catalogApi.listCareGuides });
  const guides = data?.careGuides ?? [];

  const [editing, setEditing] = useState<catalogApi.CareGuideRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", description: "", stepsText: "" });
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["catalog-care-guides"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-templates"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-types"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = { name: draft.name, description: draft.description, steps: parseSteps(draft.stepsText) };
      return editing && editing !== "new" ? catalogApi.updateCareGuide(editing.id, input) : catalogApi.createCareGuide(input);
    },
    onSuccess: () => {
      refresh();
      toast.success(editing === "new" ? "Care guide created" : "Care guide saved");
      setEditing(null);
    },
    onError: (err) => setError(describeApiError(err, "Failed to save care guide")),
  });

  function openEditor(target: catalogApi.CareGuideRow | "new") {
    setError(null);
    setEditing(target);
    setDraft(target === "new" ? { name: "", description: "", stepsText: "" } : { name: target.name, description: target.description ?? "", stepsText: target.steps.join("\n") });
  }

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      refresh();
      toast.success(success);
    } catch (err) {
      toast.error(describeApiError(err, "Action failed"));
    }
  }

  async function handleDelete(g: catalogApi.CareGuideRow) {
    const uses = g.templateCount + g.productCount;
    const note = uses > 0 ? ` It is used by ${g.templateCount} template(s) and ${g.productCount} product(s), which will fall back to no care guide.` : "";
    if (!(await confirm(`Delete the "${g.name}" care guide?${note}`))) return;
    await run(() => catalogApi.deleteCareGuide(g.id), "Care guide deleted");
  }

  return (
    <div>
      <PageHeader
        title="Catalog setup"
        description="Define what kinds of products the store sells, and what each kind collects and shows."
        action={
          canManage && (
            <Button variant="brass" onClick={() => openEditor("new")}>
              <Plus size={16} /> Add care guide
            </Button>
          )
        }
      />
      <CatalogSubNav />

      <p className="mb-4 text-sm text-ink-500">
        Reusable care instructions (&ldquo;Cotton care&rdquo;, &ldquo;Leather care&rdquo;). Set a default on a template, choose another per
        product, or let a product write its own. Editing a guide updates every product that uses it.
      </p>

      {isLoading && <p className="text-ink-400">Loading…</p>}
      {!isLoading && guides.length === 0 && <EmptyState icon={Droplets} title="No care guides yet" description="Create one, then attach it to a template or a product." />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {guides.map((g) => (
          <div key={g.id} className={cn("rounded-lg border border-ink-100 bg-cream-50 p-4", g.isArchived && "opacity-60")}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <h3 className="font-medium text-ink-900">
                  {g.name} {g.isArchived && <Badge>Archived</Badge>}
                </h3>
                <p className="text-xs text-ink-400">
                  {g.steps.length} step{g.steps.length === 1 ? "" : "s"} · {g.templateCount} template{g.templateCount === 1 ? "" : "s"} · {g.productCount} product{g.productCount === 1 ? "" : "s"}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => openEditor(g)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label={`Edit ${g.name}`}>
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => run(() => catalogApi.duplicateCareGuide(g.id), "Care guide duplicated")} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label={`Duplicate ${g.name}`}>
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => run(() => catalogApi.archiveCareGuide(g.id, !g.isArchived), g.isArchived ? "Care guide restored" : "Care guide archived")}
                    className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")}
                    aria-label={g.isArchived ? `Restore ${g.name}` : `Archive ${g.name}`}
                  >
                    {g.isArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                  </button>
                  <button onClick={() => handleDelete(g)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")} aria-label={`Delete ${g.name}`}>
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
            <ol className="list-decimal space-y-0.5 pl-5 text-sm text-ink-600">
              {g.steps.slice(0, 5).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            {g.steps.length > 5 && <p className="mt-1 text-xs text-ink-400">+ {g.steps.length - 5} more</p>}
          </div>
        ))}
      </div>
      {!canManage && <p className="mt-3 text-xs text-ink-400">Only the store owner can change catalog setup.</p>}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add care guide" : `Edit ${editing ? editing.name : ""}`} widthClassName="max-w-xl">
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
            <Label htmlFor="care-name">Name</Label>
            <Input id="care-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Cotton care" required />
          </div>
          <div>
            <Label htmlFor="care-desc">Description (admin only)</Label>
            <Input id="care-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="care-steps">Care steps (one per line)</Label>
            <Textarea id="care-steps" rows={7} value={draft.stepsText} onChange={(e) => setDraft({ ...draft, stepsText: e.target.value })} placeholder={"Machine wash cold\nDo not bleach\nTumble dry low\nIron on low heat"} />
            <p className="mt-1 text-xs text-ink-400">{parseSteps(draft.stepsText).length} step(s). Shown to customers as a list, in this order.</p>
          </div>
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
