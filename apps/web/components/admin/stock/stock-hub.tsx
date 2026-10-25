"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Droplets, PackagePlus, Boxes } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useMediaQuery } from "@/hooks/use-media-query";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as stockApi from "@/lib/api/stock";
import type { StockProblem, StockPurchase } from "@/lib/api/stock";
import { getStockActivity, getStockToday, retryAutoFill, smartKeys, type StockListItem } from "@/lib/api/stock-smart";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/tabs";
import { formatBookDate, formatPrice } from "@/lib/format";
import { ApprovalSheet } from "./approval-sheet";
import { BatchFillSheet } from "./batch-fill-sheet";
import { BoughtSheet, type BoughtStart } from "./bought-sheet";
import { ReorderSheet } from "./reorder-sheet";
import { CountedSheet } from "./counted-sheet";
import { FilledSheet } from "./filled-sheet";
import { GuidedCount } from "./guided-count";
import { ActivityPanel } from "./activity-panel";
import { ItemPanel, ItemRail, type ItemActions } from "./item-panel";
import { StockSearchBox, type QuickAction } from "./stock-search-box";
import { PolicySheet } from "./policy-sheet";
import { StockList } from "./stock-list";
import { TodayList } from "./today-list";
import { TraceSheet } from "./trace-sheet";
import type { ProductGroup } from "./stock-shared";
import { byProduct } from "./stock-shared";
import { ProblemAlert } from "./stock-problem";

type Sheet = "bought" | "reorder" | "filled" | "batch-fill" | "counted" | "guided-count" | null;
const GO_LIVE = "Stock costing starts at go-live";

/** /admin/stock (docs/STOCK_HUB.md §7): Today — what to fill, reorder, count and approve — then every item in one
 * searchable list, sorted by what needs doing. A row opens the item; an attar size goes on to its trace. */
export function StockHub() {
  const { can, ready } = useCapabilities();
  const allowed = can("inventory.view");
  const showCost = can("costing.view");
  const overview = useQuery({ queryKey: stockApi.stockKeys.overview(), queryFn: stockApi.getStockOverview, enabled: allowed });
  const today = useQuery({ queryKey: smartKeys.today(), queryFn: getStockToday, enabled: allowed });
  const purchasesQ = useQuery({ queryKey: stockApi.stockKeys.purchases(), queryFn: () => stockApi.listStockPurchases(20), enabled: allowed && can("purchasing.view") });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [finishing, setFinishing] = useState<StockPurchase | null>(null);
  const [policyFor, setPolicyFor] = useState<ProductGroup | null>(null);
  const [traceOf, setTraceOf] = useState<stockApi.StockItem | null>(null);
  const [itemOf, setItemOf] = useState<StockListItem | null>(null);
  const [approvalOf, setApprovalOf] = useState<string | null>(null);
  const [boughtStart, setBoughtStart] = useState<BoughtStart | null>(null);
  const qc = useQueryClient();
  const retryFill = useMutation({
    mutationFn: retryAutoFill,
    onSuccess: () => { toast.success("Bottles recorded as filled"); void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all }); },
    onError: (e) => toast.error(getErrorMessage(e, "The fill still couldn't be recorded")),
  });
  const activity = useQuery({ queryKey: smartKeys.activity(30), queryFn: () => getStockActivity(30), enabled: allowed });
  // the search lives in the URL (?q=) beside the list's filters
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  useEffect(() => {
    const next = new URLSearchParams(params.toString());
    if (debouncedSearch) next.set("q", debouncedSearch);
    else next.delete("q");
    const s = next.toString();
    if (s !== params.toString()) router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [debouncedSearch, params, pathname, router]);
  // wide screens show the item (or the activity) beside the list; phones switch between Stock and Activity
  const wide = useMediaQuery("(min-width: 1024px)");
  const [phoneView, setPhoneView] = useState<"stock" | "activity">("stock");
  const [countFor, setCountFor] = useState<string[] | null>(null);
  // ?open=filled|bought|counted opens that sheet once the stock has loaded — Finance's old Quick refill address lands
  // on Filled bottles this way (admin audit phase 3).
  const opened = useRef(false);
  useEffect(() => {
    const want = params.get("open");
    if (opened.current || !overview.data?.costingActive || (want !== "filled" && want !== "bought" && want !== "counted")) return;
    opened.current = true;
    setSheet(want === "filled" && today.data?.fill ? "batch-fill" : want);
  }, [params, overview.data, today.data]);

  if (ready && !allowed) return <div><ModuleTabs /><EmptyState icon={Boxes} title="Stock isn't available to your role" description="Ask the owner for access to inventory." /></div>;

  const data = overview.data;
  const live = data?.costingActive ?? false;
  const purchases = purchasesQ.data?.purchases ?? [];
  const incomplete = purchases.filter((p) => !p.complete);
  const groupOf = (key: stockApi.StockGroupKey) => data?.groups.find((g) => g.key === key)?.items ?? [];
  const actions = [
    { key: "bought" as const, label: "Received goods", icon: PackagePlus, allowed: can("purchasing.receive"), variant: "outline" as const },
    { key: "filled" as const, label: "Filled bottles", icon: Droplets, allowed: can("manufacturing.view") && groupOf("FILL_TO_ORDER").length > 0, variant: "outline" as const },
    { key: "counted" as const, label: "Count", icon: ClipboardCheck, allowed: can("inventory.adjust"), variant: "outline" as const },
  ].filter((a) => a.allowed);

  /** The one thing to do with an item, from the search box or the item itself. */
  function doAction(i: StockListItem, a: QuickAction) {
    if (!live) { toast.info(GO_LIVE); return; }
    if (a === "fill") setSheet(today.data?.fill ? "batch-fill" : "filled");
    else if (a === "reorder") { setBoughtStart({ supplierName: null, lines: [{ variantId: i.variantId, qty: Math.max(1, i.reorder?.suggested ?? 1), lastUnitCost: null }] }); setSheet("bought"); }
    else { setCountFor([i.variantId]); setSheet("guided-count"); }
  }
  const itemActions = (i: StockListItem): ItemActions => ({
    onTrace: () => { setTraceOf(i); if (!wide) setItemOf(null); },
    onPolicy: can("inventory.adjust") ? () => {
      const product = byProduct(groupOf("FILL_TO_ORDER")).find((p) => p.productId === i.productId);
      if (product) { setPolicyFor(product); if (!wide) setItemOf(null); }
    } : undefined,
    onFill: live && can("manufacturing.view") ? () => doAction(i, "fill") : undefined,
    onReorder: live && can("purchasing.receive") ? () => doAction(i, "reorder") : undefined,
    onCount: live && can("inventory.adjust") ? () => doAction(i, "count") : undefined,
  });

  const summary = data ? [
    data.totalValue !== null ? `${formatPrice(data.totalValue)} at cost` : null,
    data.lastCount ? `Last counted ${formatBookDate(data.lastCount)}` : "Not counted here yet",
  ].filter(Boolean).join(" · ") : " ";

  return (
    <div className="space-y-8">
      <div>
        <ModuleTabs />
        <PageHeader
          title="Stock"
          className="mb-0"
          description={<span data-testid="stock-summary" className="tabular-nums">{summary}</span>}
          descriptionOnPhone
          action={actions.length ? (
            <>
              {actions.map((a) => (
                <Button
                  key={a.key}
                  variant={a.variant}
                  disabled={!data || !live}
                  title={data && !live ? GO_LIVE : undefined}
                  aria-describedby={data && !live ? "stock-golive" : undefined}
                  onClick={() => setSheet(a.key === "filled" && today.data?.fill ? "batch-fill" : a.key)}
                  data-testid={`stock-action-${a.key}`}
                >
                  <a.icon className="h-4 w-4" aria-hidden="true" /> {a.label}
                </Button>
              ))}
            </>
          ) : undefined}
        />
      </div>

      {data && !live && (
        <div id="stock-golive" data-testid="stock-golive">
          <Alert variant="info" title={GO_LIVE}>
            Purchases, fills and counts are recorded here once the stock has been counted and valued. Until then, the figures below are what the shop has now.
          </Alert>
        </div>
      )}

      {incomplete.map((p) => (
        <Alert
          key={p.id}
          variant="warning"
          title="A purchase isn't finished"
          action={can("purchasing.receive") ? <Button size="sm" variant="outline" onClick={() => setFinishing(p)} data-testid="stock-finish-open">Finish</Button> : undefined}
        >
          <span data-testid="stock-incomplete">
            {formatBookDate(p.date)}, {p.supplier.name}{p.total !== null ? `, ${formatPrice(p.total)}` : ""}: stopped at {p.pendingStep ? stockApi.PENDING_STEP_LABEL[p.pendingStep] : "the last step"}. The goods and money are right once it&apos;s finished.
          </span>
        </Alert>
      ))}

      {overview.isLoading || (!ready && !data) ? (
        <div className="space-y-8" aria-busy="true" aria-label="Loading stock">
          {[0, 1, 2].map((k) => (
            <div key={k} className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : overview.isError ? (
        <ErrorState title="Stock couldn't be loaded" description={getErrorMessage(overview.error, "Check your connection and try again.")} onRetry={() => overview.refetch()} variant="bordered" />
      ) : data ? (
        <>
          <StockSearchBox value={search} onChange={setSearch} onOpen={setItemOf} onAction={(i, a) => doAction(i, a)} />
          {!wide && (
            <SegmentedControl aria-label="View" size="md" value={phoneView} onChange={setPhoneView} options={[{ value: "stock", label: "Stock", testId: "stock-view-stock" }, { value: "activity", label: "Activity", testId: "stock-view-activity" }]} />
          )}
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className={cn("min-w-0 space-y-8", !wide && phoneView !== "stock" && "hidden")}>
              {!search.trim() && (
                <TodayList
                  data={today.data}
                  done={activity.data?.today}
                  isLoading={today.isLoading}
                  isError={today.isError}
                  onRetry={() => today.refetch()}
                  actions={live ? {
                    onFill: can("manufacturing.view") ? () => setSheet("batch-fill") : undefined,
                    onReorder: can("purchasing.receive") ? () => setSheet("reorder") : undefined,
                    onCount: can("inventory.adjust") ? () => { setCountFor(null); setSheet("guided-count"); } : undefined,
                    onApproval: setApprovalOf,
                    onRetryFill: can("manufacturing.approve") ? (id) => retryFill.mutate(id) : undefined,
                  } : {}}
                />
              )}
              <StockList hasFillToOrder={groupOf("FILL_TO_ORDER").length > 0} q={debouncedSearch} selectedId={wide ? itemOf?.variantId ?? null : null} onOpen={setItemOf} />
            </div>
            {/* the side column: the item being looked at, else what happened */}
            <aside className={cn("min-w-0 lg:sticky lg:top-6 lg:self-start", !wide && phoneView !== "activity" && "hidden")}>
              {wide && itemOf ? (
                <ItemRail item={itemOf} showCost={showCost} canAdjust={can("inventory.adjust")} actions={itemActions(itemOf)} onClose={() => setItemOf(null)} />
              ) : (
                <ActivityPanel />
              )}
            </aside>
          </div>
        </>
      ) : null}

      {data && sheet === "bought" && <BoughtSheet overview={data} purchases={purchases} canOwnerMoney={can("finance.sensitive")} start={boughtStart ?? undefined} onClose={() => { setSheet(null); setBoughtStart(null); }} />}
      {sheet === "reorder" && today.data?.reorder && (
        <ReorderSheet reorder={today.data.reorder} today={today.data.today} onRecord={(s) => { setBoughtStart(s); setSheet("bought"); }} onClose={() => setSheet(null)} />
      )}
      {data && sheet === "filled" && <FilledSheet overview={data} canFill={can("manufacturing.approve")} onClose={() => setSheet(null)} />}
      {data && sheet === "batch-fill" && today.data?.fill && <BatchFillSheet overview={data} fill={today.data.fill} canFill={can("manufacturing.approve")} onSingle={() => setSheet("filled")} onClose={() => setSheet(null)} />}
      {data && sheet === "counted" && <CountedSheet overview={data} onClose={() => setSheet(null)} />}
      {data && sheet === "guided-count" && (countFor ?? today.data?.count?.due.map((d) => d.variantId)) && (
        <GuidedCount overview={data} due={countFor ?? today.data!.count!.due.map((d) => d.variantId)} showCost={showCost} onClose={() => { setSheet(null); setCountFor(null); }} />
      )}
      {policyFor && <PolicySheet product={policyFor} onClose={() => setPolicyFor(null)} />}
      {traceOf && <TraceSheet item={traceOf} showCost={showCost} onClose={() => setTraceOf(null)} />}
      {itemOf && !wide && <ItemPanel item={itemOf} showCost={showCost} canAdjust={can("inventory.adjust")} actions={itemActions(itemOf)} onClose={() => setItemOf(null)} />}
      {approvalOf && <ApprovalSheet id={approvalOf} canDecide={can("inventory.approve")} onClose={() => setApprovalOf(null)} />}
      {finishing && <FinishDialog purchase={finishing} canOwnerMoney={can("finance.sensitive")} onClose={() => setFinishing(null)} />}
    </div>
  );
}

/** Finishes a purchase that stopped part-way — from the same account, or (nothing paid yet) another one. */
function FinishDialog({ purchase, canOwnerMoney, onClose }: { purchase: StockPurchase; canOwnerMoney: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const accountsQ = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts, retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2 });
  const accounts = (accountsQ.data?.financialAccounts ?? []).filter((a) => a.isActive && ["CASH", "BANK", "MOBILE_WALLET"].includes(a.kind) && !a.name.endsWith("— own money"));
  const [from, setFrom] = useState("");
  const [problem, setProblem] = useState<StockProblem | null>(null);
  const finish = useMutation({
    mutationFn: () => stockApi.finishStockPurchase(purchase.id, from === "" ? {} : { paidFrom: from === "owner" ? { ownerPocket: true } : { financialAccountId: from } }),
    onSuccess: () => {
      toast.success("Purchase finished");
      void qc.invalidateQueries({ queryKey: stockApi.stockKeys.all });
      void qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
    onError: (e) => setProblem(stockApi.describeStockError(e, "The purchase couldn't be finished")),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Finish the purchase"
      description={`${formatBookDate(purchase.date)}, ${purchase.supplier.name}${purchase.total !== null ? `, ${formatPrice(purchase.total)}` : ""}`}
      widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={finish.isPending} onClick={() => finish.mutate()} data-testid="stock-finish-save">Finish purchase</Button></>}
    >
      <div className="space-y-4">
        {problem && <ProblemAlert problem={problem} />}
        <p className="text-sm text-fg-muted">It stopped at {purchase.pendingStep ? stockApi.PENDING_STEP_LABEL[purchase.pendingStep] : "the last step"}. Finishing runs the steps that are left.</p>
        <Field htmlFor="finish-from" label="Paid from" hint="Another account can be chosen only while nothing has been paid for it.">
          <Select id="finish-from" value={from} onChange={(e) => setFrom(e.target.value)} disabled={accountsQ.isLoading}>
            <option value="">As before: {purchase.paidFrom.kind === "OWNER" ? "owner's own money" : purchase.paidFrom.name}</option>
            {canOwnerMoney && purchase.paidFrom.kind !== "OWNER" && <option value="owner">Owner&apos;s own money</option>}
            {accounts.filter((a) => a.id !== purchase.paidFrom.financialAccountId).map((a) => <option key={a.id} value={a.id}>{a.name} ({formatPrice(a.currentBalance)})</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

