"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Printer, Trash2, X } from "lucide-react";
import { labelBatchPrintQty, type LabelBatchInput, type LabelBatchView, type ProductLabelVariant } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { useCapability } from "@/hooks/use-capability";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as warehouseApi from "@/lib/api/warehouse";
import { getErrorMessage } from "@/lib/api-client";
import { formatCount } from "@/lib/format";
import { stickerTitle } from "@/lib/sticker-layout";
import { cn } from "@/lib/utils";

type Line = { variant: ProductLabelVariant; qtyOrdered: number; qtyReceived: number | null };
interface Draft {
  id: string | null;
  name: string;
  supplier: string;
  notes: string;
  lines: Map<string, Line>;
}
type Mode = "ordered" | "received";

const MAX_QTY = 5000;

function emptyDraft(): Draft {
  const d = new Date();
  return { id: null, name: `Stock ${d.getDate()} ${d.toLocaleString("en", { month: "short" })}`, supplier: "", notes: "", lines: new Map() };
}
function toDraft(b: LabelBatchView): Draft {
  return { id: b.id, name: b.name, supplier: b.supplier ?? "", notes: b.notes ?? "", lines: new Map(b.lines.map((l) => [l.variantId, { variant: l.variant, qtyOrdered: l.qtyOrdered, qtyReceived: l.qtyReceived }])) };
}
function toInput(d: Draft): LabelBatchInput {
  return { name: d.name.trim(), supplier: d.supplier.trim() || null, notes: d.notes.trim() || null, lines: [...d.lines.values()].map((l) => ({ variantId: l.variant.variantId, qtyOrdered: l.qtyOrdered, qtyReceived: l.qtyReceived })) };
}
const sig = (d: Draft) => JSON.stringify(toInput(d));

/** Lines grouped the way a supplier thinks: one table per sticker name + tag, a row per colour (product), a column per size. */
function groupLines(lines: Line[]) {
  const groups = new Map<string, { title: string; tag: string | null; rows: Map<string, { productId: string; color: string; productName: string; cells: Map<string, Line> }>; sizes: Map<string, number> }>();
  for (const l of lines) {
    const v = l.variant;
    const title = stickerTitle(v);
    const key = `${title}|${v.labelTag ?? ""}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { title, tag: v.labelTag, rows: new Map(), sizes: new Map() }));
    let r = g.rows.get(v.productId);
    if (!r) g.rows.set(v.productId, (r = { productId: v.productId, color: v.color || v.productName, productName: v.productName, cells: new Map() }));
    r.cells.set(v.size, l);
    g.sizes.set(v.size, Math.min(g.sizes.get(v.size) ?? Infinity, v.sortOrder));
  }
  return [...groups.values()].map((g) => ({
    ...g,
    sizes: [...g.sizes.entries()].sort((a, b) => a[1] - b[1]).map(([s]) => s),
    rows: [...g.rows.values()].sort((a, b) => a.color.localeCompare(b.color)),
  }));
}

export function SupplierLists({ onPrint }: { onPrint: (rows: Array<{ variant: ProductLabelVariant; quantity: number }>) => void }) {
  const qc = useQueryClient();
  const canEdit = useCapability("orders.manage");
  const { confirm, dialog } = useConfirmDialog();
  const lists = useQuery({ queryKey: ["warehouse", "label-batches"], queryFn: ({ signal }) => warehouseApi.listLabelBatches({ signal }) });
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [mode, setMode] = useState<Mode>("ordered");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 250);

  const opened = useQuery({
    queryKey: ["warehouse", "label-batch", openId],
    queryFn: ({ signal }) => warehouseApi.getLabelBatch(openId!, { signal }),
    enabled: Boolean(openId),
  });
  useEffect(() => {
    if (!opened.data) return;
    const d = toDraft(opened.data.batch);
    setDraft(d);
    setSaved(sig(d));
    setMode(opened.data.batch.received ? "received" : "ordered");
  }, [opened.data]);

  const found = useQuery({
    queryKey: ["warehouse", "label-search", "lists", q],
    queryFn: ({ signal }) => warehouseApi.listProductLabelVariants({ search: q, limit: 200 }, { signal }),
    enabled: Boolean(draft) && q.length >= 2,
  });
  const foundProducts = useMemo(() => {
    const m = new Map<string, ProductLabelVariant[]>();
    for (const v of found.data?.variants ?? []) m.set(v.productId, [...(m.get(v.productId) ?? []), v]);
    return [...m.values()];
  }, [found.data]);

  const dirty = draft ? sig(draft) !== saved : false;
  const lines = draft ? [...draft.lines.values()] : [];
  const groups = useMemo(() => groupLines(lines), [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalOrdered = lines.reduce((n, l) => n + l.qtyOrdered, 0);
  const totalToPrint = lines.reduce((n, l) => n + labelBatchPrintQty(l), 0);

  const save = useMutation({
    mutationFn: (d: Draft) => (d.id ? warehouseApi.updateLabelBatch(d.id, toInput(d)) : warehouseApi.createLabelBatch(toInput(d))),
    onSuccess: ({ batch }) => {
      const d = toDraft(batch);
      setDraft(d);
      setSaved(sig(d));
      setOpenId(batch.id);
      qc.setQueryData(["warehouse", "label-batch", batch.id], { batch });
      void qc.invalidateQueries({ queryKey: ["warehouse", "label-batches"] });
      toast.success("List saved");
    },
    onError: (err) => toast.error(getErrorMessage(err, "The list wasn't saved")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => warehouseApi.deleteLabelBatch(id),
    onSuccess: () => {
      setDraft(null);
      setOpenId(null);
      void qc.invalidateQueries({ queryKey: ["warehouse", "label-batches"] });
      toast.success("List deleted");
    },
    onError: (err) => toast.error(getErrorMessage(err, "The list wasn't deleted")),
  });

  async function leave(next: () => void) {
    if (dirty && !(await confirm("This list has changes that aren't saved. Leave without saving?", { confirmLabel: "Leave", title: "Unsaved changes" }))) return;
    next();
  }
  function edit(fn: (d: Draft) => void) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next: Draft = { ...prev, lines: new Map(prev.lines) };
      fn(next);
      return next;
    });
  }
  function addProduct(vs: ProductLabelVariant[]) {
    edit((d) => {
      for (const v of vs) if (!d.lines.has(v.variantId)) d.lines.set(v.variantId, { variant: v, qtyOrdered: 0, qtyReceived: null });
    });
  }
  function setQty(variantId: string, raw: string) {
    const n = raw === "" ? null : Math.max(0, Math.min(MAX_QTY, Number.parseInt(raw, 10) || 0));
    edit((d) => {
      const l = d.lines.get(variantId);
      if (!l) return;
      d.lines.set(variantId, mode === "ordered" ? { ...l, qtyOrdered: n ?? 0 } : { ...l, qtyReceived: n });
    });
  }
  function print() {
    if (!draft) return;
    onPrint(lines.filter((l) => labelBatchPrintQty(l) > 0).map((l) => ({ variant: l.variant, quantity: labelBatchPrintQty(l) })));
  }

  // ---- list of lists -------------------------------------------------------------------------------------------
  if (!draft) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-prose text-sm text-fg-muted">
            Write down what you order from a supplier, size by size. When the goods arrive, count them in and print every sticker in one go.
          </p>
          {canEdit && (
            <Button size="sm" onClick={() => { const d = emptyDraft(); setDraft(d); setSaved(""); setMode("ordered"); }}>
              <Plus size={14} /> New list
            </Button>
          )}
        </div>
        {(lists.isLoading || opened.isLoading) && <Skeleton className="h-24 w-full" />}
        {lists.isError && <ErrorState description="Supplier lists didn't load." onRetry={() => void lists.refetch()} />}
        {opened.isError && <ErrorState description="That list didn't open." onRetry={() => void opened.refetch()} />}
        {lists.data && lists.data.batches.length === 0 && (
          <EmptyState variant="bordered" icon={ClipboardList} title="No supplier lists yet" description="Start a list before you go to the supplier, or when the goods arrive." />
        )}
        {lists.data && lists.data.batches.length > 0 && (
          <Card className="divide-y divide-line-subtle overflow-hidden p-0">
            {lists.data.batches.map((b) => (
              <button key={b.id} type="button" onClick={() => setOpenId(b.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ink-900/[0.03]">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-fg">{b.name}</span>
                  <span className="block text-sm text-fg-muted">
                    {[b.supplier, new Date(b.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  <span className="block font-medium text-fg">{formatCount(b.toPrint)} stickers</span>
                  <span className="block text-fg-muted">{b.received ? "Counted in" : `${formatCount(b.ordered)} ordered`}</span>
                </span>
              </button>
            ))}
          </Card>
        )}
        {dialog}
      </div>
    );
  }

  // ---- one list ----------------------------------------------------------------------------------------------------
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button size="sm" variant="ghost" onClick={() => void leave(() => { setDraft(null); setOpenId(null); })}>
          ← All lists
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && draft.id && (
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Delete this list"
              onClick={async () => {
                if (await confirm(`Delete “${draft.name}”? Stickers already printed stay as they are.`, { confirmLabel: "Delete", title: "Delete list" })) remove.mutate(draft.id!);
              }}
            >
              <Trash2 size={16} />
            </IconButton>
          )}
          {canEdit && (
            <Button size="sm" variant="outline" disabled={!dirty || !draft.name.trim()} loading={save.isPending} onClick={() => save.mutate(draft)}>
              Save
            </Button>
          )}
          <Button size="sm" disabled={totalToPrint === 0} onClick={() => void leave(print)}>
            <Printer size={14} /> Print {formatCount(totalToPrint)} stickers
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="list-name" label="List name">
          <Input id="list-name" value={draft.name} maxLength={80} disabled={!canEdit} onChange={(e) => edit((d) => { d.name = e.target.value; })} />
        </Field>
        <Field htmlFor="list-supplier" label="Supplier">
          <Input id="list-supplier" value={draft.supplier} maxLength={80} placeholder="e.g. YG Fashion" disabled={!canEdit} onChange={(e) => edit((d) => { d.supplier = e.target.value; })} />
        </Field>
      </div>

      {canEdit && (
        <div className="space-y-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Add a product: name or SKU" aria-label="Search products to add to the list" />
          {q.length >= 2 && (
            <Card className="divide-y divide-line-subtle overflow-hidden p-0">
              {found.isLoading && <Skeleton className="m-3 h-8" />}
              {found.isError && <ErrorState variant="plain" description="Search didn't load." onRetry={() => void found.refetch()} />}
              {found.data && foundProducts.length === 0 && <p className="p-4 text-sm text-fg-muted">No product matches “{q}”.</p>}
              {foundProducts.map((vs) => {
                const inList = vs.every((v) => draft.lines.has(v.variantId));
                return (
                  <div key={vs[0]!.productId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-fg">{vs[0]!.productName}</span>
                      <span className="block text-fg-muted">{vs.map((v) => v.size).join(" · ")}</span>
                    </span>
                    <Button size="sm" variant="outline" disabled={inList} onClick={() => addProduct(vs)}>
                      {inList ? "Added" : <><Plus size={14} /> Add</>}
                    </Button>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState variant="bordered" icon={ClipboardList} title="No products in this list" description="Search above and add each product you're buying; every size comes with it." />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl<Mode>
              aria-label="Which count to edit"
              value={mode}
              onChange={setMode}
              options={[
                { value: "ordered", label: "Ordered" },
                { value: "received", label: "Received" },
              ]}
            />
            {mode === "received" && canEdit && (
              <Button size="sm" variant="ghost" onClick={() => edit((d) => { for (const [k, l] of d.lines) d.lines.set(k, { ...l, qtyReceived: l.qtyOrdered }); })}>
                Everything arrived as ordered
              </Button>
            )}
          </div>
          <p className="text-sm text-fg-muted">
            {mode === "ordered"
              ? "How many of each size you're ordering."
              : "How many actually arrived. A blank box prints the ordered count."}{" "}
            <span className="tabular-nums">
              {formatCount(totalOrdered)} ordered · {formatCount(totalToPrint)} stickers to print
            </span>
          </p>
          {groups.map((g) => (
            <section key={`${g.title}|${g.tag ?? ""}`} className="space-y-2">
              <h3 className="flex items-center gap-2">
                <span className="font-medium text-fg">{g.title}</span>
                {g.tag && <span className="rounded-full bg-ink-900 px-2 py-0.5 text-xs font-medium text-white">{g.tag}</span>}
              </h3>
              <TableContainer>
                <Table className="min-w-max">
                  <TableHead>
                    <tr>
                      <TableHeaderCell className="sticky left-0 bg-surface">Colour</TableHeaderCell>
                      {g.sizes.map((s) => (
                        <TableHeaderCell key={s} align="center" className="px-1.5">{s}</TableHeaderCell>
                      ))}
                      <TableHeaderCell align="right">Total</TableHeaderCell>
                      {canEdit && <TableHeaderCell className="w-10 px-2"><span className="sr-only">Remove</span></TableHeaderCell>}
                    </tr>
                  </TableHead>
                  <tbody>
                    {g.rows.map((r) => {
                      const rowTotal = [...r.cells.values()].reduce((n, l) => n + (mode === "ordered" ? l.qtyOrdered : labelBatchPrintQty(l)), 0);
                      return (
                        <TableRow key={r.productId}>
                          <th scope="row" className="sticky left-0 bg-surface px-4 py-1.5 text-left font-medium text-fg">{r.color}</th>
                          {g.sizes.map((s) => {
                            const l = r.cells.get(s);
                            if (!l) return <TableCell key={s} align="center" className="px-1.5 py-1.5 text-fg-subtle">—</TableCell>;
                            const value = mode === "ordered" ? (l.qtyOrdered ? String(l.qtyOrdered) : "") : l.qtyReceived == null ? "" : String(l.qtyReceived);
                            const short = mode === "received" && l.qtyReceived != null && l.qtyReceived !== l.qtyOrdered;
                            return (
                              <TableCell key={s} align="center" className="px-1.5 py-1.5">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  max={MAX_QTY}
                                  value={value}
                                  placeholder={mode === "received" ? String(l.qtyOrdered) : "0"}
                                  disabled={!canEdit}
                                  onChange={(e) => setQty(l.variant.variantId, e.target.value)}
                                  aria-label={`${g.title} ${r.color} ${s}, ${mode}`}
                                  className={cn(
                                    "h-9 w-14 rounded-md border bg-surface text-center text-base tabular-nums placeholder:text-fg-subtle sm:text-sm",
                                    short ? "border-warning-500 text-fg" : "border-line",
                                  )}
                                />
                              </TableCell>
                            );
                          })}
                          <TableCell align="right" className="py-1.5 font-medium text-fg">{formatCount(rowTotal)}</TableCell>
                          {canEdit && (
                            <TableCell className="px-2 py-1.5">
                              <IconButton variant="ghost" size="sm" aria-label={`Remove ${r.productName} from the list`} onClick={() => edit((d) => { for (const l of r.cells.values()) d.lines.delete(l.variant.variantId); })}>
                                <X size={14} />
                              </IconButton>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </tbody>
                </Table>
              </TableContainer>
            </section>
          ))}
        </>
      )}
      {dialog}
    </div>
  );
}
