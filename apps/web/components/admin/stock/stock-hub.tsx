"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Droplets, PackagePlus, Boxes } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { ApiError, getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as stockApi from "@/lib/api/stock";
import type { StockProblem, StockPurchase } from "@/lib/api/stock";
import { formatBookDate, formatPrice } from "@/lib/format";
import { BoughtSheet } from "./bought-sheet";
import { CountedSheet } from "./counted-sheet";
import { FilledSheet } from "./filled-sheet";
import { FillGroup, FinishedGroup, MaterialGroup } from "./stock-row";
import { num } from "./stock-shared";
import { ProblemAlert } from "./stock-problem";

type Sheet = "bought" | "filled" | "counted" | null;
const GO_LIVE = "Stock costing starts at go-live";

/** /admin/stock (docs/STOCK_HUB.md): everything in stock in three groups, and the three things the owner records. */
export function StockHub() {
  const { can, ready } = useCapabilities();
  const allowed = can("inventory.view");
  const showCost = can("costing.view");
  const overview = useQuery({ queryKey: stockApi.stockKeys.overview(), queryFn: stockApi.getStockOverview, enabled: allowed });
  const purchasesQ = useQuery({ queryKey: stockApi.stockKeys.purchases(), queryFn: () => stockApi.listStockPurchases(20), enabled: allowed && can("purchasing.view") });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [finishing, setFinishing] = useState<StockPurchase | null>(null);

  if (ready && !allowed) return <div><ModuleTabs /><EmptyState icon={Boxes} title="Stock isn't available to your role" description="Ask the owner for access to inventory." /></div>;

  const data = overview.data;
  const live = data?.costingActive ?? false;
  const purchases = purchasesQ.data?.purchases ?? [];
  const incomplete = purchases.filter((p) => !p.complete);
  const groupOf = (key: stockApi.StockGroupKey) => data?.groups.find((g) => g.key === key)?.items ?? [];
  const actions = [
    { key: "bought" as const, label: "Bought", icon: PackagePlus, allowed: can("purchasing.receive"), variant: "primary" as const },
    { key: "filled" as const, label: "Filled", icon: Droplets, allowed: can("manufacturing.view") && groupOf("FILL_TO_ORDER").length > 0, variant: "outline" as const },
    { key: "counted" as const, label: "Counted", icon: ClipboardCheck, allowed: can("inventory.adjust"), variant: "outline" as const },
  ].filter((a) => a.allowed);

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
                  onClick={() => setSheet(a.key)}
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
          <FillGroup items={groupOf("FILL_TO_ORDER")} />
          <MaterialGroup items={groupOf("MATERIAL")} rolls={data.rolls} showCost={showCost} />
          <FinishedGroup items={groupOf("FINISHED")} showCost={showCost} />
          {can("purchasing.view") && <RecentPurchases query={purchasesQ} />}
        </>
      ) : null}

      {data && sheet === "bought" && <BoughtSheet overview={data} purchases={purchases} canOwnerMoney={can("finance.sensitive")} onClose={() => setSheet(null)} />}
      {data && sheet === "filled" && <FilledSheet overview={data} canFill={can("manufacturing.approve")} onClose={() => setSheet(null)} />}
      {data && sheet === "counted" && <CountedSheet overview={data} onClose={() => setSheet(null)} />}
      {finishing && <FinishDialog purchase={finishing} canOwnerMoney={can("finance.sensitive")} onClose={() => setFinishing(null)} />}
    </div>
  );
}

function RecentPurchases({ query }: { query: { data?: { purchases: StockPurchase[] }; isLoading: boolean; isError: boolean; refetch: () => unknown } }) {
  const rows = (query.data?.purchases ?? []).slice(0, 5);
  return (
    <section aria-labelledby="stock-recent" className="space-y-3" data-testid="stock-recent">
      <h2 id="stock-recent" className="text-lg font-semibold tracking-tight text-fg">Recent purchases</h2>
      {query.isLoading ? <Skeleton className="h-24 w-full rounded-xl" /> : query.isError ? (
        <p className="text-sm text-fg-muted">Recent purchases couldn&apos;t be loaded. <button type="button" className="font-medium text-fg underline underline-offset-4" onClick={() => query.refetch()}>Try again</button></p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">None yet. Everything you record with Bought shows here.</p>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line-subtle">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3" data-testid="stock-recent-row">
                <span className="min-w-0">
                  <span className="block text-[15px] text-fg">{p.lines.map((l) => `${num(l.quantity)} ${l.unit === "pcs" ? "×" : l.unit} ${l.name}`).join(", ")}</span>
                  <span className="block text-xs text-fg-muted">{formatBookDate(p.date)} · {p.supplier.name} · paid from {p.paidFrom.kind === "OWNER" ? "the owner's own money" : p.paidFrom.name}</span>
                </span>
                <span className="flex items-center gap-2">
                  {!p.complete ? <Badge variant="warning">Not finished</Badge> : p.paymentStatus === "PENDING_APPROVAL" ? <Badge variant="info">Payment awaits approval</Badge> : null}
                  {p.total !== null && <span className="tabular-nums text-fg">{formatPrice(p.total)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
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

