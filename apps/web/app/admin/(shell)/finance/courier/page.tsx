"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Scale, Truck, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import * as booksApi from "@/lib/api/finance-books";
import type { CourierOrderRow } from "@/lib/api/finance-books";
import type { OrderStatus } from "@clothing-brand/shared";
import { OrderStatusBadge } from "@/components/admin/orders/order-badges";
import { courierStatusBadgeClass, courierStatusDescription, courierStatusLabel, formatBookDate, formatPrice, formatPriceWhole } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { PermissionState } from "@/components/admin/permission-state";

/** Owner's books §3.6: the courier's side of the books on one page — what the books expect from Steadfast next to its own
 * balance, payouts to bring in and post, and the parcels that need a look (unpaid, stuck, status mismatch, partial). */
export default function CourierCheckPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const rec = useQuery({ queryKey: booksApi.booksKeys.courier(), queryFn: booksApi.getCourierReconciliation, enabled: allowed });
  const accounts = useQuery({ queryKey: financeApi.financeKeys.accounts(), queryFn: financeApi.listFinancialAccounts, enabled: allowed });
  const [dest, setDest] = useState("");
  const claims = useQuery({ queryKey: booksApi.claimKeys.all, queryFn: booksApi.listClaims, enabled: allowed });
  const [claimFor, setClaimFor] = useState<CourierOrderRow | null>(null);
  const [settling, setSettling] = useState<booksApi.CourierClaim | null>(null);
  const refreshClaims = () => { void queryClient.invalidateQueries({ queryKey: booksApi.claimKeys.all }); void queryClient.invalidateQueries({ queryKey: ["finance"] }); };
  const payInto = (accounts.data?.financialAccounts ?? []).filter((a) => a.isActive && ["BANK", "MOBILE_WALLET", "CASH"].includes(a.kind));
  const destination = dest || rec.data?.settings.payoutAccountId || "";
  const imp = useMutation({
    mutationFn: () => booksApi.importCourierPayouts(destination),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
      if (r.problems.length) toast.error(`${r.imported.length} imported; ${r.problems.length} couldn't be read — import their payout file in Courier & gateway payouts`);
      else toast.success(r.imported.length ? `${r.imported.length} payout${r.imported.length === 1 ? "" : "s"} brought in as drafts — check and post them` : `Nothing new (${r.alreadyRecorded} already recorded)`);
    },
    onError: (e) => toast.error(getErrorMessage(e, "Steadfast's payouts couldn't be read")),
  });

  if (ready && !allowed) return <div><ModuleTabs /><PermissionState icon={Truck} page="This page" /></div>;
  const d = rec.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Steadfast check" description="What Steadfast should hold for you, next to what it says it holds — and every parcel that needs a look." />
      {rec.isLoading && <Skeleton className="h-40 w-full" />}
      {rec.isError && <Alert variant="danger" title="The courier check couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => rec.refetch()}>Retry</Button>}>{getErrorMessage(rec.error, "")}</Alert>}
      {d && (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Balances">
            <StatTile label="Steadfast should pay you" value={formatPriceWhole(Math.round(d.books.expectedFromCourier))} icon={<Truck />} tone="accent" />
            {d.courier.balance === null ? (
              <Card className="flex items-start gap-3 p-3.5 sm:col-span-2 sm:p-5" data-testid="courier-balance-unknown">
                <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-fg">Steadfast&apos;s own balance couldn&apos;t be read right now</p>
                  <p className="mt-0.5 text-fg-muted">Open the Steadfast panel and compare its balance with {formatPrice(Math.round(d.books.expectedFromCourier))}. This page tries again each time it opens.</p>
                </div>
              </Card>
            ) : (
              <>
                <StatTile label="Steadfast's own balance" value={formatPriceWhole(Math.round(d.courier.balance))} icon={<Wallet />} />
                <StatTile label="Difference" value={d.courier.difference === null ? "—" : formatPrice(Math.round(d.courier.difference))} tone={d.courier.difference ? "warning" : "default"} icon={<Scale />} />
              </>
            )}
          </section>
          <p className="text-xs text-fg-muted">
            Collected and not yet paid out {formatPrice(d.books.codClearing)}, less charges booked against it {formatPrice(d.books.chargesAccrued)}.
            {d.courier.balance !== null && " A difference usually means a payout not posted yet, a partial delivery not settled, or a charge the rate card got wrong."}
          </p>

          <Card className="space-y-3 p-4 sm:p-5">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-fg">Bring in Steadfast’s payouts</h2>
              <p className="text-sm text-fg-muted">Each new payout becomes a draft, matched to its orders by consignment. Check the money reached the account, then post it.</p>
            </div>
            {can("finance.transact") && (
              <div className="flex flex-wrap items-end gap-3">
                <Field htmlFor="payout-dest" label="Steadfast pays into" className="w-full sm:w-72" hint={destination ? undefined : "Choose the account first — payouts are recorded into it"}>
                  <Select id="payout-dest" value={destination} onChange={(e) => setDest(e.target.value)}>
                    <option value="">Choose…</option>
                    {payInto.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </Field>
                <Button disabled={!destination} loading={imp.isPending} onClick={() => imp.mutate()} data-testid="import-payouts"><Download className="h-4 w-4" /> Import payouts</Button>
              </div>
            )}
            {d.draftPayouts.length > 0 ? (
              <ul className="divide-y divide-line-subtle text-sm" data-testid="draft-payouts">
                {d.draftPayouts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{p.reference} · {formatBookDate(p.date)}</span>
                    <span className="flex items-center gap-3"><span className="tabular-nums">{formatPrice(p.net)}</span><Link href="/admin/finance/settlements" className="text-sm font-medium text-accent hover:underline">Check & post</Link></span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-fg-muted"><CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden /> No draft payouts waiting.</p>
            )}
          </Card>

          <OrderList title={`Delivered, not paid out after ${d.settings.unsettledDays} days`} hint="Ask Steadfast about these, or look for them in a payout not imported yet." rows={d.unsettled} testId="unsettled" />
          <OrderList title={`On the way more than ${d.settings.staleDays} days`} hint="Possibly lost — check the parcel on Steadfast; claim it if it's lost." rows={d.stale} testId="stale" action={can("finance.transact") ? (o) => <Button size="sm" variant="outline" onClick={() => setClaimFor(o)}>Claim</Button> : undefined} />
          <OrderList title="Order status and Steadfast disagree" hint="Delivered here but not at Steadfast, or the other way round. Fix the order, or mark it delivered outside the courier." rows={d.statusMismatch} testId="mismatch" />
          <section className="space-y-2" data-testid="claims">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-fg">Claims for lost parcels</h2>
              {claims.data && <span className="text-sm tabular-nums text-fg-muted">{formatPrice(claims.data.totals.outstanding)} still to come</span>}
            </div>
            <p className="text-sm text-fg-muted">What Steadfast owes you for parcels it lost. Cancel the order and record the items as lost in Inventory; the claim is the money side.</p>
            {claims.data && (claims.data.claims.length === 0 ? <p className="text-sm text-fg-muted">No claims.</p> : (
              <Card className="divide-y divide-line p-0 text-sm">
                {claims.data.claims.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5" data-testid="claim-row">
                    <span className="min-w-0">
                      <span className="block text-fg">{c.number} · <Link href={`/admin/orders/${c.orderId}`} className="text-accent hover:underline">{c.orderNumber}</Link></span>
                      <span className="block text-xs text-fg-muted">{formatBookDate(c.claimDate)} · {c.reason} · received {formatPrice(c.received)} of {formatPrice(c.amount)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {c.status === "SETTLED" ? <Badge variant="success">settled</Badge> : <Badge variant="warning">{formatPrice(c.outstanding)} open</Badge>}
                      {c.status === "OPEN" && can("finance.transact") && <Button size="sm" variant="outline" onClick={() => setSettling(c)}>Settle</Button>}
                    </span>
                  </div>
                ))}
              </Card>
            ))}
          </section>
          <OrderList title="Partly delivered" hint="Record which items came back on the order, so revenue, stock and the payout agree." rows={d.partialDeliveries} testId="partial" badge={(o) => ("reconciled" in o && o.reconciled ? <Badge variant="success">items reconciled</Badge> : <Badge variant="warning">to reconcile</Badge>)} />
        </>
      )}
      {claimFor && <ClaimModal order={claimFor} onClose={() => setClaimFor(null)} onDone={() => { setClaimFor(null); refreshClaims(); }} />}
      {settling && <SettleModal claim={settling} accounts={payInto} onClose={() => setSettling(null)} onDone={() => { setSettling(null); refreshClaims(); }} />}
    </div>
  );
}

function ClaimModal({ order, onClose, onDone }: { order: CourierOrderRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(order.total));
  const [reason, setReason] = useState("Parcel lost in transit");
  const save = useMutation({
    mutationFn: () => booksApi.openClaim({ orderId: order.id, amount: Number(amount), reason: reason.trim() }),
    onSuccess: (c) => { toast.success(`${c.number} opened — ${formatPrice(c.amount)} owed by Steadfast`); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "The claim couldn't be opened")),
  });
  return (
    <Modal open onClose={onClose} title={`Claim for ${order.orderNumber}`} description="What you claim from Steadfast for the lost parcel." widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!(Number(amount) > 0) || reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()} data-testid="confirm-claim">Open claim</Button></>}>
      <div className="grid gap-3">
        <Field htmlFor="cl-amount" label="Amount claimed" required><Input id="cl-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field htmlFor="cl-reason" label="Reason" required><Input id="cl-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
      </div>
    </Modal>
  );
}

function SettleModal({ claim, accounts, onClose, onDone }: { claim: booksApi.CourierClaim; accounts: financeApi.FinancialAccount[]; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"MONEY" | "PAYOUT" | "WRITE_OFF">("MONEY");
  const [amount, setAmount] = useState(String(claim.outstanding));
  const [accountId, setAccountId] = useState("");
  const body = { kind, amount: Number(amount), financialAccountId: kind === "MONEY" ? accountId : null };
  const save = useMutation({
    mutationFn: () => booksApi.settleClaim(claim.id, body, idempotencyKeyFor(`claim-${claim.id}`, body)),
    onSuccess: (c) => { settleIdempotencyKey(`claim-${claim.id}`); toast.success(c.status === "SETTLED" ? `${c.number} settled` : `${formatPrice(c.outstanding)} still open`); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't record it")),
  });
  return (
    <Modal open onClose={onClose} title={`Settle ${claim.number}`} description={`${formatPrice(claim.outstanding)} is still open.`} widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!(Number(amount) > 0) || (kind === "MONEY" && !accountId)} loading={save.isPending} onClick={() => save.mutate()} data-testid="confirm-settle-claim">Record</Button></>}>
      <div className="grid gap-3">
        <Field htmlFor="st-kind" label="What happened">
          <Select id="st-kind" value={kind} onChange={(e) => setKind(e.target.value as "MONEY" | "PAYOUT" | "WRITE_OFF")}>
            <option value="MONEY">Steadfast paid it into an account</option>
            <option value="PAYOUT">It came inside a COD payout</option>
            <option value="WRITE_OFF">They won’t pay this part — write it off</option>
          </Select>
        </Field>
        {kind === "MONEY" && (
          <Field htmlFor="st-acc" label="Into" required>
            <Select id="st-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Choose…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </Field>
        )}
        {kind === "PAYOUT" && <p className="text-xs text-fg-muted">Post that payout with the extra as a settlement adjustment; this moves it onto the claim.</p>}
        <Field htmlFor="st-amount" label="Amount" required><Input id="st-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function OrderList({ title, hint, rows, testId, badge, action }: { title: string; hint: string; rows: CourierOrderRow[]; testId: string; badge?: (o: CourierOrderRow) => React.ReactNode; action?: (o: CourierOrderRow) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <section className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        <span className={cn("text-sm tabular-nums", rows.length ? "text-warning-700" : "text-fg-muted")}>{rows.length ? `${rows.length} order${rows.length === 1 ? "" : "s"}` : "none"}</span>
      </div>
      <p className="text-sm text-fg-muted">{hint}</p>
      {rows.length > 0 && (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Order</TableHeaderCell>
                <TableHeaderCell>Customer</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Steadfast</TableHeaderCell>
                <TableHeaderCell>Booked</TableHeaderCell>
                <TableHeaderCell align="right">Total</TableHeaderCell>
                {action && <TableHeaderCell />}
              </tr>
            </TableHead>
            <tbody>
              {(all ? rows : rows.slice(0, 20)).map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="whitespace-nowrap"><Link href={`/admin/orders/${o.id}`} className="font-medium text-accent hover:underline">{o.orderNumber}</Link></TableCell>
                  <TableCell className="whitespace-nowrap">{o.customerName}</TableCell>
                  <TableCell><span className="flex flex-wrap items-center gap-1.5"><OrderStatusBadge status={o.status as OrderStatus} short />{badge?.(o)}</span></TableCell>
                  <TableCell>{o.courierStatus ? <Badge className={courierStatusBadgeClass(o.courierStatus)} title={courierStatusDescription(o.courierStatus)}>{courierStatusLabel(o.courierStatus)}</Badge> : <span className="text-fg-subtle">—</span>}</TableCell>
                  <TableCell className="whitespace-nowrap">{o.bookedOn ? formatBookDate(o.bookedOn) : "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{formatPrice(o.total)}</TableCell>
                  {action && <TableCell align="right">{action(o)}</TableCell>}
                </TableRow>
              ))}
            </tbody>
          </Table>
          {rows.length > 20 && (
            <div className="border-t border-line-subtle px-2 py-1.5">
              <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${rows.length}`}</Button>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}
