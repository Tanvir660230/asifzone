"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Copy, Pencil, Plus, Ruler, Trash2 } from "lucide-react";
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
  unit: string;
  notes: string;
  columns: string[];
  rows: string[][];
}

const NEW_DRAFT: Draft = { name: "", description: "", unit: "", notes: "", columns: ["Size", "Measurement"], rows: [["S", ""], ["M", ""], ["L", ""]] };

function ChartTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-ink-400">
            {columns.map((c, i) => (
              <th key={i} className="border-b border-ink-100 px-2 pb-2 first:pl-0">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className={cn("border-b border-ink-50 px-2 py-1.5 text-ink-600 first:pl-0", c === 0 && "font-medium text-ink-900")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SizeGuidesPage() {
  const queryClient = useQueryClient();
  const canManage = useCanManageCatalog();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data, isLoading } = useQuery({ queryKey: ["catalog-size-guides"], queryFn: catalogApi.listSizeGuides });
  const guides = data?.sizeGuides ?? [];

  const [editing, setEditing] = useState<catalogApi.SizeGuideRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["catalog-size-guides"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-templates"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-types"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = { name: draft.name, description: draft.description, unit: draft.unit, notes: draft.notes, columns: draft.columns, rows: draft.rows };
      return editing && editing !== "new" ? catalogApi.updateSizeGuide(editing.id, input) : catalogApi.createSizeGuide(input);
    },
    onSuccess: () => {
      refresh();
      toast.success(editing === "new" ? "Size guide created" : "Size guide saved");
      setEditing(null);
    },
    onError: (err) => setError(describeApiError(err, "Failed to save size guide")),
  });

  function openEditor(target: catalogApi.SizeGuideRow | "new") {
    setError(null);
    setEditing(target);
    setDraft(
      target === "new"
        ? NEW_DRAFT
        : {
            name: target.name,
            description: target.description ?? "",
            unit: target.unit ?? "",
            notes: target.notes ?? "",
            columns: [...target.columns],
            rows: target.rows.map((r) => [...r]),
          },
    );
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

  async function handleDelete(g: catalogApi.SizeGuideRow) {
    if (!(await confirm(`Delete the "${g.name}" size guide? This cannot be undone.`))) return;
    await run(() => catalogApi.deleteSizeGuide(g.id), "Size guide deleted");
  }

  const setCell = (r: number, c: number, value: string) =>
    setDraft((d) => ({ ...d, rows: d.rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row)) }));

  return (
    <div>
      <PageHeader
        title="Catalog setup"
        description="Define what kinds of products the store sells, and what each kind collects and shows."
        action={
          canManage && (
            <Button variant="brass" onClick={() => openEditor("new")}>
              <Plus size={16} /> Add size guide
            </Button>
          )
        }
      />
      <CatalogSubNav />

      <p className="mb-4 text-sm text-ink-500">
        Reusable size charts — a cap chart, a shoe chart, an apparel chart. Each can have its own columns. Attach one to a template so
        every product of that type shows it; a single product can still override it with its own table.
      </p>

      {isLoading && <p className="text-ink-400">Loading…</p>}
      {!isLoading && guides.length === 0 && <EmptyState icon={Ruler} title="No size guides yet" description="Create one, then attach it to a template." />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {guides.map((g) => (
          <div key={g.id} className={cn("rounded-lg border border-ink-100 bg-cream-50 p-4", g.isArchived && "opacity-60")}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 className="font-medium text-ink-900">
                  {g.name} {g.isArchived && <Badge>Archived</Badge>}
                </h3>
                <p className="text-xs text-ink-400">
                  {g.unit ? `${g.unit} · ` : ""}
                  {g.rows.length} rows · used by {g.templateCount} template{g.templateCount === 1 ? "" : "s"}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => openEditor(g)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label={`Edit ${g.name}`}>
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => run(() => catalogApi.duplicateSizeGuide(g.id), "Size guide duplicated")} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label={`Duplicate ${g.name}`}>
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => run(() => catalogApi.archiveSizeGuide(g.id, !g.isArchived), g.isArchived ? "Size guide restored" : "Size guide archived")}
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
            <ChartTable columns={g.columns} rows={g.rows.slice(0, 6)} />
            {g.rows.length > 6 && <p className="mt-1 text-xs text-ink-400">+ {g.rows.length - 6} more rows</p>}
          </div>
        ))}
      </div>
      {!canManage && <p className="mt-3 text-xs text-ink-400">Only the store owner can change catalog setup.</p>}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add size guide" : `Edit ${editing ? editing.name : ""}`} widthClassName="max-w-3xl">
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            saveMutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="sg-name">Name</Label>
              <Input id="sg-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Cap size guide" required />
            </div>
            <div>
              <Label htmlFor="sg-unit">Unit label</Label>
              <Input id="sg-unit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="cm, inch, cm (foot length)" />
            </div>
          </div>
          <div>
            <Label htmlFor="sg-desc">Description (admin only)</Label>
            <Input id="sg-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Chart</Label>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setDraft((d) => ({ ...d, columns: [...d.columns, `Column ${d.columns.length + 1}`], rows: d.rows.map((r) => [...r, ""]) }))}>
                  + Column
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setDraft((d) => ({ ...d, rows: [...d.rows, new Array(d.columns.length).fill("")] }))}>
                  + Row
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white p-2">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {draft.columns.map((col, c) => (
                      <th key={c} className="border-b border-ink-100 p-1.5">
                        <div className="flex items-center gap-1">
                          <Input value={col} className="h-8 text-xs font-semibold" aria-label={`Column ${c + 1} heading`} onChange={(e) => setDraft((d) => ({ ...d, columns: d.columns.map((x, i) => (i === c ? e.target.value : x)) }))} />
                          {draft.columns.length > 1 && (
                            <button type="button" className="px-1 text-xs text-danger-500" aria-label={`Remove column ${col}`} onClick={() => setDraft((d) => ({ ...d, columns: d.columns.filter((_, i) => i !== c), rows: d.rows.map((r) => r.filter((_, i) => i !== c)) }))}>
                              ×
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="w-8 border-b border-ink-100" />
                  </tr>
                </thead>
                <tbody>
                  {draft.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c} className="border-b border-ink-50 p-1.5">
                          <Input value={cell} className="h-8 text-xs" aria-label={`Row ${r + 1}, ${draft.columns[c]}`} onChange={(e) => setCell(r, c, e.target.value)} />
                        </td>
                      ))}
                      <td className="border-b border-ink-50 text-center">
                        {draft.rows.length > 1 && (
                          <button type="button" className="text-xs font-bold text-danger-500" aria-label={`Remove row ${r + 1}`} onClick={() => setDraft((d) => ({ ...d, rows: d.rows.filter((_, i) => i !== r) }))}>
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <Label htmlFor="sg-notes">Notes shown under the chart</Label>
            <Textarea id="sg-notes" rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="e.g. Measure around the widest part of your head…" />
          </div>

          <div>
            <Label>Preview (as customers see it)</Label>
            <div className="rounded-lg border border-ink-100 bg-white p-4">
              <p className="mb-3 text-xs text-ink-500">All measurements are in {draft.unit || "inches"}.</p>
              <ChartTable columns={draft.columns} rows={draft.rows} />
              {draft.notes && <p className="mt-3 whitespace-pre-line text-xs text-ink-500">{draft.notes}</p>}
            </div>
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
