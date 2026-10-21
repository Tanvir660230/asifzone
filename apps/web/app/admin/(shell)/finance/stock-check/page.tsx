"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, ChevronDown, ChevronRight, Download, PackageCheck, Truck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as booksApi from "@/lib/api/finance-books";
import type { MaterialRollRow, StockCheckFinished, StockCheckMaterial, StockCountResult } from "@/lib/api/finance-books";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const today = () => new Date().toLocaleDateString("en-CA");
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const variantLabel = (v: { size: string; color: string }) => [v.color, v.size].filter((x) => x && x !== "-").join(" · ") || "—";

interface ProductGroup {
  productId: string;
  product: string;
  variants: StockCheckFinished[];
  stock: number; delivered: number; moving: number; returned: number; throughSite: number; typedIn: number; edits: number;
  counted: number | null; countDiff: number | null;
}

function groupFinished(rows: StockCheckFinished[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>();
  for (const r of rows) {
    const g = map.get(r.productId) ?? { productId: r.productId, product: r.product, variants: [], stock: 0, delivered: 0, moving: 0, returned: 0, throughSite: 0, typedIn: 0, edits: 0, counted: null, countDiff: null };
    g.variants.push(r);
    g.stock += r.stock;
    g.delivered += r.out.delivered;
    g.moving += r.out.onTheWay + r.out.waiting + r.out.partly;
    g.returned += r.out.returned;
    g.throughSite += r.throughSite;
    g.typedIn += r.typedIn;
    g.edits += r.editsWithoutReason;
    if (r.count) {
      g.counted = (g.counted ?? 0) + r.count.counted;
      g.countDiff = (g.countDiff ?? 0) + r.count.difference;
    }
    map.set(r.productId, g);
  }
  return [...map.values()].filter((g) => g.throughSite > 0 || g.stock > 0);
}

/** Category totals — "how many caps did I have" across every colour and size. */
function byCategory(rows: StockCheckFinished[]) {
  const map = new Map<string, { name: string; throughSite: number; delivered: number; moving: number; stock: number; counted: number; countedVariants: number; variants: number }>();
  for (const r of rows) {
    const name = r.category ?? "Uncategorised";
    const c = map.get(name) ?? { name, throughSite: 0, delivered: 0, moving: 0, stock: 0, counted: 0, countedVariants: 0, variants: 0 };
    c.throughSite += r.throughSite;
    c.delivered += r.out.delivered;
    c.moving += r.out.onTheWay + r.out.waiting + r.out.partly + r.out.returned;
    c.stock += r.stock;
    c.variants += 1;
    if (r.count) { c.counted += r.count.counted; c.countedVariants += 1; }
    map.set(name, c);
  }
  return [...map.values()].filter((c) => c.throughSite > 0).sort((a, b) => b.throughSite - a.throughSite);
}

/** Docs FINANCE_CENTER.md §7: where every unit went, rebuilt from the shop's own records — nothing forced to balance. */
export default function StockCheckPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("finance.view");
  const canRecord = can("finance.transact");
  const queryClient = useQueryClient();
  const report = useQuery({ queryKey: booksApi.stockCheckKeys.report(), queryFn: booksApi.getStockCheck, enabled: allowed });
  const rolls = useQuery({ queryKey: booksApi.stockCheckKeys.rolls(), queryFn: booksApi.listRolls, enabled: allowed });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [counting, setCounting] = useState<{ variantId: string; label: string; stock: number; unit: string } | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finance", "center"] });
  const groups = useMemo(() => groupFinished(report.data?.finished ?? []), [report.data]);
  const categories = useMemo(() => byCategory(report.data?.finished ?? []), [report.data]);
  const materials = report.data?.materials ?? [];

  if (ready && !allowed) return <div><ModuleTabs /><EmptyState icon={Boxes} title="The stock check isn't available to your role" /></div>;
  const d = report.data;

  const exportCsv = () => {
    if (!d) return;
    const rows = [
      ...d.finished.map((f) => ({ type: "product", product: f.product, variant: variantLabel(f), sku: f.sku, unit: "pcs", delivered: f.out.delivered, partlyDelivered: f.out.partly, returnedNotPutBack: f.out.returned, onTheWay: f.out.onTheWay, waiting: f.out.waiting, stock: f.stock, throughSite: f.throughSite, onDocument: f.cameInOnDocument, typedIn: f.typedIn, usedByRecipes: "", boughtAtLeast: "", counted: f.count?.counted ?? "", countDate: f.count?.date ?? "", difference: f.count?.difference ?? "" })),
      ...d.materials.map((m) => ({ type: "material", product: m.product, variant: variantLabel(m), sku: m.sku, unit: m.unit, delivered: "", partlyDelivered: "", returnedNotPutBack: "", onTheWay: "", waiting: "", stock: m.stock, throughSite: "", onDocument: m.cameInOnDocument, typedIn: "", usedByRecipes: m.usedByRecipes ?? "", boughtAtLeast: m.boughtAtLeast ?? "", counted: m.count?.counted ?? "", countDate: m.count?.date ?? "", difference: m.count?.difference ?? "" })),
    ];
    const cols = Object.keys(rows[0] ?? { type: "" }).map((k) => ({ key: k, label: k }));
    downloadCsv(`stock-check-${d.asOf}.csv`, toCsv(cols, rows));
  };

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Stock check"
        description="Where every piece went, from the shop's own orders and stock. Nothing here changes stock or the books — counts sit beside the site's numbers, and differences stay visible."
        action={d && <Button size="sm" variant="outline" onClick={exportCsv} data-testid="stock-check-csv"><Download className="h-4 w-4" /> CSV</Button>}
      />
      {report.isLoading && <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>}
      {report.isError && <Alert variant="danger" title="The stock check couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => report.refetch()}>Retry</Button>}>{getErrorMessage(report.error, "")}</Alert>}
      {d && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Pieces through the site" value={num(groups.reduce((s, g) => s + g.throughSite, 0))} icon={<Boxes />} />
            <StatTile label="Delivered" value={num(groups.reduce((s, g) => s + g.delivered, 0))} icon={<PackageCheck />} />
            <StatTile label="Partly delivered, not settled" value={num(d.checks.partlyUnsettled)} tone={d.checks.partlyUnsettled ? "warning" : "default"} href="/admin/orders?status=PARTIALLY_DELIVERED" icon={<Truck />} />
            <StatTile label="Returned, not back in stock" value={num(d.checks.returnedNotRestocked)} tone={d.checks.returnedNotRestocked ? "warning" : "default"} href="/admin/orders?status=RETURNED" icon={<Truck />} />
          </section>

          {categories.length > 0 && (
            <Card className="space-y-3 p-5 sm:p-6" data-testid="stock-by-category">
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight text-fg">By category</h2>
                <p className="text-sm text-fg-muted">Pieces that came through the site, all colours and sizes together. Add pieces sent outside the site (straight through the courier) to get what was bought.</p>
              </div>
              <ul className="divide-y divide-line-subtle text-sm">
                {categories.map((c) => (
                  <li key={c.name} className="flex items-start justify-between gap-4 py-2.5">
                    <span className="min-w-0 font-medium text-fg">{c.name}<span className="block text-xs font-normal text-fg-muted">{num(c.delivered)} delivered · {num(c.moving)} on the way, waiting or returned · {num(c.stock)} in stock</span></span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className="block text-[17px] font-semibold text-fg">{num(c.throughSite)}</span>
                      {c.countedVariants > 0 && <span className={cn("block text-xs", c.counted === c.stock ? "text-success-700" : "text-warning-700")}>{c.countedVariants === c.variants ? `counted ${num(c.counted)}` : `${c.countedVariants} of ${c.variants} counted`}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-end justify-between gap-2 px-4 pt-4 sm:px-5">
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight text-fg">Products</h2>
                <p className="text-sm text-fg-muted">Through the site = still out on orders + in stock. Cancelled pieces put back are not counted twice.</p>
              </div>
            </div>
            {groups.length === 0 ? <p className="px-5 py-6 text-sm text-fg-muted">No products with stock or orders yet.</p> : (
              <TableContainer className="mt-3 rounded-none border-x-0 border-b-0">
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell className="min-w-[15rem]">Product</TableHeaderCell>
                      <TableHeaderCell align="right" className="hidden whitespace-nowrap sm:table-cell">Delivered</TableHeaderCell>
                      <TableHeaderCell align="right" className="hidden whitespace-nowrap md:table-cell" title="On the way, waiting to ship or partly delivered">On the way</TableHeaderCell>
                      <TableHeaderCell align="right" className="whitespace-nowrap">In stock</TableHeaderCell>
                      <TableHeaderCell align="right" className="whitespace-nowrap" title="Still out on orders + in stock">Through site</TableHeaderCell>
                      <TableHeaderCell align="right" className="hidden whitespace-nowrap lg:table-cell" title="Stock typed in without a purchase or goods receipt">Typed in</TableHeaderCell>
                      <TableHeaderCell align="right" className="whitespace-nowrap">Counted</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <tbody>
                    {groups.map((g) => {
                      const isOpen = open.has(g.productId);
                      const one = g.variants.length === 1 ? g.variants[0]! : null;
                      return (
                        <Fragment key={g.productId}>
                          <TableRow>
                            <TableCell>
                              <button
                                type="button"
                                className="flex items-start gap-1.5 text-left font-medium text-fg"
                                aria-expanded={isOpen}
                                onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(g.productId)) n.delete(g.productId); else n.add(g.productId); return n; })}
                              >
                                {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" />}
                                <span className="min-w-0">
                                  {g.product}
                                  <span className="block text-xs font-normal text-fg-muted">{g.variants.length} variant{g.variants.length === 1 ? "" : "s"}{g.returned ? ` · ${g.returned} returned` : ""}</span>
                                  {g.edits > 0 && <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-warning-700"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-500" aria-hidden />{g.edits} stock edit{g.edits === 1 ? "" : "s"} without a reason</span>}
                                </span>
                              </button>
                            </TableCell>
                            <TableCell align="right" className="hidden tabular-nums sm:table-cell">{num(g.delivered)}</TableCell>
                            <TableCell align="right" className="hidden tabular-nums md:table-cell">{num(g.moving)}</TableCell>
                            <TableCell align="right" className="tabular-nums">{num(g.stock)}</TableCell>
                            <TableCell align="right" className="tabular-nums font-medium text-fg">{num(g.throughSite)}</TableCell>
                            <TableCell align="right" className="hidden tabular-nums lg:table-cell">{num(g.typedIn)}</TableCell>
                            <TableCell align="right">
                              {one ? (
                                <CountCell count={one.count} onCount={canRecord ? () => setCounting({ variantId: one.variantId, label: g.product, stock: one.stock, unit: "pcs" }) : undefined} />
                              ) : g.counted !== null ? <CountValue counted={g.counted} diff={g.countDiff ?? 0} /> : <button type="button" className="whitespace-nowrap text-xs font-medium text-accent hover:underline" onClick={() => setOpen((s) => new Set(s).add(g.productId))} hidden={isOpen}>Count by size</button>}
                            </TableCell>
                          </TableRow>
                          {isOpen && g.variants.map((v) => (
                            <TableRow key={v.variantId} className="bg-surface-muted">
                              <TableCell className="pl-10 text-sm text-fg-muted">{variantLabel(v)}<span className="block text-xs text-fg-subtle">{v.sku}</span></TableCell>
                              <TableCell align="right" className="hidden tabular-nums sm:table-cell">{num(v.out.delivered)}</TableCell>
                              <TableCell align="right" className="hidden tabular-nums md:table-cell">{num(v.out.onTheWay + v.out.waiting + v.out.partly)}</TableCell>
                              <TableCell align="right" className="tabular-nums">{num(v.stock)}</TableCell>
                              <TableCell align="right" className="tabular-nums">{num(v.throughSite)}</TableCell>
                              <TableCell align="right" className="hidden tabular-nums lg:table-cell">{num(v.typedIn)}</TableCell>
                              <TableCell align="right"><CountCell count={v.count} onCount={canRecord ? () => setCounting({ variantId: v.variantId, label: `${g.product} — ${variantLabel(v)}`, stock: v.stock, unit: "pcs" }) : undefined} /></TableCell>
                            </TableRow>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </Table>
              </TableContainer>
            )}
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="px-4 pt-4 sm:px-5">
              <h2 className="text-[17px] font-semibold tracking-tight text-fg">Materials</h2>
              <p className="text-sm text-fg-muted">
                Used = each product&apos;s approved recipe × its pieces through the site. Bought at least = used + what is left (your count, else the site stock) — before wastage and samples.
                {d.checks.recipes === 0 && <> No recipe is approved yet — add one in <Link href="/admin/manufacturing/boms" className="text-accent hover:underline">Recipes</Link>.</>}
              </p>
            </div>
            {materials.length === 0 ? <p className="px-5 py-6 text-sm text-fg-muted">No materials yet — add oil, bottles and packaging in <Link href="/admin/manufacturing/materials" className="text-accent hover:underline">Materials</Link>.</p> : (
              <TableContainer className="mt-3 rounded-none border-x-0 border-b-0">
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Material</TableHeaderCell>
                      <TableHeaderCell align="right">In stock</TableHeaderCell>
                      <TableHeaderCell align="right" className="hidden sm:table-cell">Used by products</TableHeaderCell>
                      <TableHeaderCell align="right">Bought at least</TableHeaderCell>
                      <TableHeaderCell align="right">Counted</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <tbody>
                    {materials.map((m) => (
                      <TableRow key={m.variantId}>
                        <TableCell className="font-medium text-fg">{m.product}<span className="block text-xs font-normal text-fg-muted">{variantLabel(m)} · {m.unit}{m.unitCost !== null ? ` · ${formatPrice(m.unitCost)} each` : ""}</span></TableCell>
                        <TableCell align="right" className="tabular-nums">{num(m.stock)}</TableCell>
                        <TableCell align="right" className="hidden tabular-nums sm:table-cell">{m.usedByRecipes === null ? <span className="text-xs text-fg-subtle">no recipe</span> : <>{num(m.usedByRecipes)}<span className="block text-xs text-fg-subtle">{num(m.finishedUnits ?? 0)} pieces</span></>}</TableCell>
                        <TableCell align="right" className="tabular-nums font-medium text-fg">{m.boughtAtLeast === null ? "—" : <>{num(m.boughtAtLeast)}<span className="block text-xs font-normal text-fg-subtle">{m.boughtBasis === "count" ? "with your count" : "with the site stock"}</span></>}</TableCell>
                        <TableCell align="right"><CountCell count={m.count} onCount={canRecord ? () => setCounting({ variantId: m.variantId, label: `${m.product} — ${variantLabel(m)}`, stock: m.stock, unit: m.unit }) : undefined} /></TableCell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </TableContainer>
            )}
          </Card>

          <RollsCard rolls={rolls.data?.rolls ?? []} average={rolls.data?.averagePerParcel ?? null} loading={rolls.isLoading} materials={materials} canRecord={canRecord} onDone={refresh} />

          <Card className="space-y-3 p-5 sm:p-6">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-fg">Parcels sent straight through Steadfast</h2>
              <p className="text-sm text-fg-muted">In Steadfast&apos;s payouts but never an order on the site. Their contents aren&apos;t known — a parcel isn&apos;t a sale until you count it as one on its payout.</p>
            </div>
            {d.directShipments.length === 0 ? <p className="text-sm text-fg-muted">None — every paid parcel matched an order.</p> : (
              <ul className="divide-y divide-line-subtle text-sm">
                {d.directShipments.map((s) => (
                  <li key={s.reference} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0"><span className="font-medium text-fg">{s.reference.replace(/^steadfast:/, "")}</span><span className="block text-xs text-fg-muted">{formatBookDate(s.date)} · {s.parcels} parcel{s.parcels === 1 ? "" : "s"}</span></span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{formatPrice(s.amount)}</span>
                      {s.outsideSale === s.parcels ? <Badge variant="success">sales outside the website</Badge> : <Link href="/admin/finance/settlements" className="text-xs text-accent hover:underline">{s.parcels - s.outsideSale} to decide</Link>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {d.checks.shippedWithoutCourier > 0 && <p className="text-xs text-fg-muted">{d.checks.shippedWithoutCourier} shipped or delivered order{d.checks.shippedWithoutCourier === 1 ? " has" : "s have"} no courier booking (hand delivery, or booked outside the site).</p>}
          </Card>
        </>
      )}
      {counting && <CountModal target={counting} onClose={() => setCounting(null)} onDone={() => { setCounting(null); refresh(); }} />}
    </div>
  );
}

function CountValue({ counted, diff }: { counted: number; diff: number }) {
  return (
    <span className="tabular-nums">
      {num(counted)}
      <span className={cn("block text-xs", diff === 0 ? "text-success-700" : "text-warning-700")}>{diff === 0 ? "matches" : `${diff > 0 ? "+" : ""}${num(diff)} vs site`}</span>
    </span>
  );
}

function CountCell({ count, onCount }: { count: StockCountResult; onCount?: () => void }) {
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {count && <CountValue counted={count.counted} diff={count.difference} />}
      {onCount && <button type="button" onClick={onCount} className="text-xs font-medium text-accent hover:underline">{count ? "Count again" : "Count"}</button>}
    </span>
  );
}

function CountModal({ target, onClose, onDone }: { target: { variantId: string; label: string; stock: number; unit: string }; onClose: () => void; onDone: () => void }) {
  const [counted, setCounted] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const n = Number(counted);
  const valid = counted !== "" && Number.isInteger(n) && n >= 0 && Boolean(date) && date <= today();
  const save = useMutation({
    mutationFn: () => booksApi.recordStockCount({ variantId: target.variantId, counted: n, countDate: date, note: note.trim() || null }),
    onSuccess: (r) => { toast.success(r.difference === 0 ? "Counted — matches the site" : `Counted — ${r.difference > 0 ? "+" : ""}${r.difference} against the site`); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The count couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={`Count ${target.label}`} description="Recorded beside the site's stock — the site's number doesn't change. A count is kept as it was; count again to replace it." widthClassName="max-w-sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()} data-testid="save-count">Save count</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-fg-muted">The site shows <span className="font-medium tabular-nums text-fg">{num(target.stock)} {target.unit}</span>.</p>
        <Field htmlFor="sc-counted" label={`Counted (${target.unit})`} required><Input id="sc-counted" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, "").slice(0, 8))} autoFocus /></Field>
        <Field htmlFor="sc-date" label="Counted on" required><Input id="sc-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="sc-note" label="Note" hint="Optional"><Input id="sc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      </div>
    </Modal>
  );
}

function RollsCard({ rolls, average, loading, materials, canRecord, onDone }: { rolls: MaterialRollRow[]; average: number | null; loading: boolean; materials: StockCheckMaterial[]; canRecord: boolean; onDone: () => void }) {
  const [opening, setOpening] = useState(false);
  const [finishing, setFinishing] = useState<MaterialRollRow | null>(null);
  return (
    <Card className="space-y-3 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-tight text-fg">Rolls</h2>
          <p className="text-sm text-fg-muted">Bubble poly and anything else used up over many parcels. A roll&apos;s parcels are the courier bookings between opening and finishing it — the cost per parcel appears once a roll is finished.{average !== null && <> Average so far: <span className="font-medium tabular-nums text-fg">{formatPrice(average)}</span> a parcel.</>}</p>
        </div>
        {canRecord && <Button size="sm" variant="outline" onClick={() => setOpening(true)} disabled={materials.length === 0} data-testid="open-roll">Roll opened</Button>}
      </div>
      {loading ? <Skeleton className="h-16 w-full" /> : rolls.length === 0 ? <p className="text-sm text-fg-muted">No rolls recorded. When you open a new roll, note it here; when it runs out, finish it.</p> : (
        <ul className="divide-y divide-line-subtle text-sm">
          {rolls.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0">
                <span className="font-medium text-fg">{r.material}</span>
                <span className="block text-xs text-fg-muted">{formatBookDate(r.openedOn)} → {r.finishedOn ? formatBookDate(r.finishedOn) : "in use"} · {num(r.parcels)} parcel{r.parcels === 1 ? "" : "s"}{r.parcelsCounted !== null ? " (counted)" : " (from courier bookings)"}</span>
              </span>
              <span className="flex items-center gap-2">
                {r.perParcel !== null ? <span className="tabular-nums">{formatPrice(r.perParcel)} a parcel</span> : <Badge variant="neutral">yield not known yet</Badge>}
                {canRecord && <Button size="sm" variant="outline" onClick={() => setFinishing(r)}>{r.finishedOn ? "Correct" : "Finished"}</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {opening && <OpenRollModal materials={materials} onClose={() => setOpening(false)} onDone={() => { setOpening(false); onDone(); }} />}
      {finishing && <FinishRollModal roll={finishing} onClose={() => setFinishing(null)} onDone={() => { setFinishing(null); onDone(); }} />}
    </Card>
  );
}

function OpenRollModal({ materials, onClose, onDone }: { materials: StockCheckMaterial[]; onClose: () => void; onDone: () => void }) {
  const [materialId, setMaterialId] = useState(materials.find((m) => /bubble/i.test(m.product))?.variantId ?? "");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => booksApi.openRoll({ materialVariantId: materialId, openedOn: date, note: note.trim() || null }),
    onSuccess: () => { toast.success("Roll noted as opened"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't save the roll")),
  });
  return (
    <Modal open onClose={onClose} title="Roll opened" widthClassName="max-w-sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!materialId || !date || date > today()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <Field htmlFor="ro-mat" label="Material" required>
          <Select id="ro-mat" value={materialId} onChange={(e) => setMaterialId(e.target.value)}><option value="">Choose…</option>{materials.map((m) => <option key={m.variantId} value={m.variantId}>{m.product}{m.size ? ` ${m.size}` : ""}</option>)}</Select>
        </Field>
        <Field htmlFor="ro-date" label="Opened on" required><Input id="ro-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="ro-note" label="Note" hint="Optional"><Input id="ro-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      </div>
    </Modal>
  );
}

function FinishRollModal({ roll, onClose, onDone }: { roll: MaterialRollRow; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(roll.finishedOn ?? today());
  const [parcels, setParcels] = useState(roll.parcelsCounted ? String(roll.parcelsCounted) : "");
  const save = useMutation({
    mutationFn: () => booksApi.finishRoll(roll.id, { finishedOn: date, parcelsCounted: parcels ? Number(parcels) : null }),
    onSuccess: () => { toast.success("Roll finished"); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't save")),
  });
  return (
    <Modal open onClose={onClose} title={`${roll.material} finished`} description={`Opened ${formatBookDate(roll.openedOn)}. ${num(roll.parcelsBooked)} parcels were booked with the courier since.`} widthClassName="max-w-sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!date || date < roll.openedOn || date > today()} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <Field htmlFor="rf-date" label="Ran out on" required error={date && date < roll.openedOn ? "Before it was opened" : undefined}><Input id="rf-date" type="date" value={date} min={roll.openedOn} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field htmlFor="rf-parcels" label="Parcels packed from it" hint="Only if you counted them — otherwise the courier bookings are used"><Input id="rf-parcels" inputMode="numeric" value={parcels} onChange={(e) => setParcels(e.target.value.replace(/\D/g, "").slice(0, 7))} /></Field>
      </div>
    </Modal>
  );
}
