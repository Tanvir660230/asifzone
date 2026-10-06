"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { normalizeSearchKeyword } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { TagInput } from "@/components/admin/tag-input";
import { useCanManageCatalog } from "@/hooks/use-can-manage-catalog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";

interface Draft {
  terms: string[];
  isActive: boolean;
}

function TermChips({ terms }: { terms: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {terms.map((t) => (
        <span key={t} className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs text-ink-700 ring-1 ring-inset ring-line-subtle">
          {t}
        </span>
      ))}
    </div>
  );
}

/** Store-wide search synonyms: words that should find the same products ("ator" = "attar" = "আতর"), on top of the
 * built-in dictionary. The "Test a search" box shows exactly what a shopper's query finds with the current groups.
 * `?add=<word>` (linked from the no-result searches report) opens a new group with that word already in it. */
export default function SearchSynonymsPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const canManage = useCanManageCatalog();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data, isLoading } = useQuery({ queryKey: ["catalog-search-synonyms"], queryFn: catalogApi.listSearchSynonyms });
  const synonyms = data?.synonyms ?? [];

  const [editing, setEditing] = useState<catalogApi.SearchSynonymRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>({ terms: [], isActive: true });
  const [error, setError] = useState<string | null>(null);

  const [testQuery, setTestQuery] = useState("");
  const debouncedQuery = useDebouncedValue(testQuery.trim(), 300);
  const preview = useQuery({
    queryKey: ["catalog-search-preview", debouncedQuery],
    queryFn: () => catalogApi.previewSearch(debouncedQuery),
    enabled: debouncedQuery.length > 0,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["catalog-search-synonyms"] });
    queryClient.invalidateQueries({ queryKey: ["catalog-search-preview"] });
  };

  function openEditor(target: catalogApi.SearchSynonymRow | "new", terms: string[] = []) {
    setError(null);
    setEditing(target);
    setDraft(target === "new" ? { terms, isActive: true } : { terms: target.terms, isActive: target.isActive });
  }

  // Arriving from the no-result report: test that word and start a group with it.
  const addParam = searchParams.get("add");
  useEffect(() => {
    if (!addParam) return;
    setTestQuery(addParam);
    if (canManage) openEditor("new", [normalizeSearchKeyword(addParam)].filter(Boolean));
  }, [addParam, canManage]);

  const saveMutation = useMutation({
    mutationFn: () =>
      editing && editing !== "new" ? catalogApi.updateSearchSynonym(editing.id, draft) : catalogApi.createSearchSynonym(draft),
    onSuccess: () => {
      refresh();
      toast.success(editing === "new" ? "Synonym group added" : "Synonym group saved");
      setEditing(null);
    },
    onError: (err) => setError(describeApiError(err, "Failed to save synonym group")),
  });

  async function handleDelete(row: catalogApi.SearchSynonymRow) {
    if (!(await confirm(`Delete the group "${row.terms.join(", ")}"? Searches for these words stop finding each other.`))) return;
    try {
      await catalogApi.deleteSearchSynonym(row.id);
      refresh();
      toast.success("Synonym group deleted");
    } catch (err) {
      toast.error(describeApiError(err, "Failed to delete synonym group"));
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
              <Plus size={16} /> Add synonym group
            </Button>
          )
        }
      />
      <ModuleTabs />

      <p className="mb-4 text-sm text-ink-500">
        Words customers type that should find the same products. Put every spelling in one group — e.g. <em>ator, attar, আতর, perfume</em> —
        and searching any of them finds products that use any other, across the whole store. For a word that only fits one product, use
        that product&rsquo;s <strong>search tags</strong> instead.
      </p>

      {/* Test a search */}
      <div className="mb-6 rounded-lg border border-ink-100 bg-cream-50 p-4">
        <Label htmlFor="syn-test">Test a search</Label>
        <Input
          id="syn-test"
          leading={<Search size={16} />}
          value={testQuery}
          onChange={(e) => setTestQuery(e.target.value)}
          placeholder="Type what a customer would search, e.g. ator"
          autoComplete="off"
        />
        {debouncedQuery && preview.data && (
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-ink-400">Searches for</p>
              <TermChips terms={preview.data.terms} />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-ink-400">
                {preview.data.total === 0 ? "No products found" : `${preview.data.total} product${preview.data.total === 1 ? "" : "s"} found`}
              </p>
              {preview.data.total === 0 ? (
                <p className="text-ink-500">
                  Customers searching this see nothing. Add it to a synonym group with a word your products use, or add it as a search tag on the
                  right products.
                </p>
              ) : (
                <ul className="divide-y divide-ink-100 rounded-md border border-ink-100 bg-white/60">
                  {preview.data.products.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />
                      ) : (
                        <span className="h-8 w-8 rounded bg-ink-100" />
                      )}
                      <Link href={`/admin/products/${p.id}/edit`} className="truncate text-ink-800 hover:underline">
                        {p.name}
                      </Link>
                    </li>
                  ))}
                  {preview.data.total > preview.data.products.length && (
                    <li className="px-3 py-2 text-xs text-ink-400">…and {preview.data.total - preview.data.products.length} more</li>
                  )}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <table className="ui-table">
          <thead className="ui-table-head">
            <tr>
              <th className="px-4 py-3">Words that find each other</th>
              <th className="px-4 py-3">Status</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={3} cols={canManage ? 3 : 2} />}
            {!isLoading && synonyms.length === 0 && (
              <tr>
                <td colSpan={3}>
                  <EmptyState icon={ArrowLeftRight} title="No synonym groups yet" description="Add the spellings and words your customers search with." />
                </td>
              </tr>
            )}
            {synonyms.map((row) => (
              <tr key={row.id} className={cn("border-t border-ink-100 hover:bg-ink-50/60", !row.isActive && "opacity-60")}>
                <td className="px-4 py-3">
                  <TermChips terms={row.terms} />
                </td>
                <td className="px-4 py-3">{row.isActive ? <Badge variant="success">Active</Badge> : <Badge>Off</Badge>}</td>
                {canManage && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      <button onClick={() => openEditor(row)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")} aria-label={`Edit ${row.terms.join(", ")}`}>
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleDelete(row)} className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")} aria-label={`Delete ${row.terms.join(", ")}`}>
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
      {!canManage && <p className="mt-3 text-xs text-ink-400">Only the store owner can change search synonyms.</p>}

      {data && data.builtIn.length > 0 && (
        <details className="mt-6 rounded-lg border border-ink-100 bg-cream-50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink-700">Built-in synonyms ({data.builtIn.length} groups) — always on</summary>
          <p className="mt-2 text-xs text-ink-500">
            Search already knows these. A group you add above that uses one of these words covers all of that word&rsquo;s spellings too.
          </p>
          <ul className="mt-3 space-y-2">
            {data.builtIn.map((group) => (
              <li key={group.join("|")}>
                <TermChips terms={group} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add synonym group" : "Edit synonym group"} widthClassName="max-w-lg">
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
            <Label htmlFor="syn-terms">Words</Label>
            <TagInput id="syn-terms" value={draft.terms} onChange={(terms) => setDraft({ ...draft, terms })} max={30} />
            <p className="mt-1 text-xs text-ink-500">Press Enter or comma after each word. e.g. ator, attar, আতর, perfume</p>
          </div>
          {editing !== "new" && (
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <Checkbox checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              Active — turn off to stop using this group without deleting it
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="brass" disabled={saveMutation.isPending || draft.terms.length < 2}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
