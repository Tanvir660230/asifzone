"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, Scale } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { CutoverCostSource, CutoverLine, CutoverValuationStatus } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";

const KEY = [...financeApi.financeKeys.all, "inventory-cutover"] as const;
const STATUS_BADGE = { KNOWN: "success", ESTIMATED: "warning", MISSING: "danger" } as const;
const STATUS_LABEL = { KNOWN: "known", ESTIMATED: "estimated", MISSING: "no cost" } as const;
const BATCH_BADGE = { DRAFT: "neutral", APPROVED: "info", POSTED: "success" } as const;
const SOURCE_LABEL: Record<CutoverCostSource, string> = {
  OPENING_COUNT: "Opening count",
  CATALOG_VARIANT: "Catalog (variant)",
  CATALOG_PRODUCT: "Catalog (product)",
  OWNER: "Owner",
  SUPPLIER_INVOICE: "Supplier invoice",
  NONE: "None",
  ADDED_AT_POST: "Added at post",
};
const PAGE_SIZE = 50;

/**
 * Valuation cutover (docs/FINANCE_PHASE_4C.md): the one-time step that makes inventory costing authoritative. The owner
 * approves a unit cost for every stock-tracked variant; posting values the stock on hand at that moment, trues the inventory
 * account up with one journal and switches costing on — permanently.
 */
export default function InventoryCutoverPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("costing.view");
  const canAdjust = can("costing.adjust");
  const [filter, setFilter] = useState<"ALL" | CutoverValuationStatus>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CutoverLine | null>(null);
  const [dialog, setDialog] = useState<"approve" | "reopen" | "post" | "opening" | null>(null);

  const overview = useQuery({ queryKey: KEY, queryFn: financeApi.getCutover, enabled: allowed });
  const q = { status: filter === "ALL" ? undefined : filter, search: search.trim() || undefined, page, pageSize: PAGE_SIZE };
  const lines = useQuery({ queryKey: [...KEY, "lines", q], queryFn: () => financeApi.listCutoverLines(q), enabled: allowed && Boolean(overview.data?.batch) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });

  const draft = useMutation({
    mutationFn: () => financeApi.draftCutover(),
    onSuccess: (r) => { refresh(); toast.success(`${r.summary.lines} variant(s) on the cutover`); },
    onError: (err) => toast.error(getErrorMessage(err, "The cutover couldn't be prepared")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Scale} title="Inventory costing is limited to the owner and finance roles" />
      </div>
    );
  }

  const data = overview.data;
  const batch = data?.batch ?? null;
  const editable = canAdjust && batch?.status === "DRAFT";
  const pre = data?.prerequisites;
  const totalPages = lines.data ? Math.max(1, Math.ceil(lines.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Valuation cutover"
        description="Give every stock-tracked product a starting unit cost. Posting values the stock on hand at that moment, trues the inventory account up in one journal and switches inventory costing on. It happens once and can't be undone."
        action={
          canAdjust && batch?.status !== "POSTED" && !pre?.costingActive ? (
            <Button size="sm" variant={batch ? "outline" : "primary"} loading={draft.isPending} disabled={batch?.status === "APPROVED"} onClick={() => draft.mutate()} data-testid="cutover-draft">
              {batch ? "Refresh from stock" : "Prepare cutover"}
            </Button>
          ) : undefined
        }
      />

      {overview.isLoading && <Skeleton className="h-40 w-full" />}
      {overview.isError && <Alert variant="danger" title="The cutover couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => overview.refetch()}>Retry</Button>}>{getErrorMessage(overview.error, "")}</Alert>}

      {data && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card className="space-y-4 p-5" data-testid="cutover-status">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-ink-600">Status</p>
                <p className="text-lg font-semibold text-ink-900">
                  {pre?.costingActive && batch?.status !== "POSTED" ? "Costing already active" : batch ? { DRAFT: "Draft — costs being reviewed", APPROVED: "Approved — ready to post", POSTED: "Posted — costing is active" }[batch.status] : "Not started"}
                </p>
              </div>
              {batch && <Badge variant={BATCH_BADGE[batch.status]} data-testid="cutover-batch-status">{batch.status.toLowerCase()}</Badge>}
            </div>
            {batch?.status === "POSTED" && batch.summary ? <PostedSummary summary={batch.summary} /> : data.preview && data.summary ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <Figure label="Inventory account now" value={formatPrice(data.preview.ledger)} />
                <Figure label="Valuation at these costs" value={formatPrice(data.preview.valuation)} />
                <Figure label="In transit to customers" value={formatPrice(data.preview.inTransit)} hint={`${data.preview.inTransitOrders} order(s)`} />
                <Figure label="True-up if posted now" value={formatPrice(data.preview.adjustment)} strong testId="cutover-adjustment" />
              </dl>
            ) : (
              <p className="text-sm text-ink-600">Prepare the cutover to list every stock-tracked variant with a proposed cost.</p>
            )}
            {batch && batch.status !== "POSTED" && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                {canAdjust && batch.status === "DRAFT" && <Button size="sm" onClick={() => setDialog("approve")} data-testid="cutover-approve">Approve costs</Button>}
                {canAdjust && batch.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => setDialog("opening")}>Opening-balance error…</Button>}
                {canAdjust && batch.status === "APPROVED" && <Button size="sm" variant="destructive" onClick={() => setDialog("post")} data-testid="cutover-post">Post cutover</Button>}
                {canAdjust && batch.status === "APPROVED" && <Button size="sm" variant="outline" onClick={() => setDialog("reopen")}>Back to draft</Button>}
                {batch.openingErrorAmount !== 0 && <span className="text-sm text-ink-600">Opening-balance error: {formatPrice(batch.openingErrorAmount)} → opening balance equity</span>}
              </div>
            )}
          </Card>

          {batch?.status === "POSTED" ? (
            <Card className="space-y-2 p-5">
              <p className="font-medium text-ink-900">What happens now</p>
              <p className="text-sm text-ink-700">Every stock movement is valued at the moving average cost, and sales take their cost from it. Run the finance checks to confirm the inventory account matches the valuation.</p>
              <Link href="/admin/finance/checks" className="inline-block text-sm font-medium text-fg underline-offset-4 hover:underline">Open finance checks</Link>
            </Card>
          ) : (
          <Card className="space-y-3 p-5">
            <p className="font-medium text-ink-900">Before posting</p>
            <ul className="space-y-2 text-sm">
              <Prerequisite ok={Boolean(pre?.openingDateSet)}>Financial opening date set</Prerequisite>
              <Prerequisite ok={Boolean(pre?.openingBalancesPosted)}>Opening balances posted</Prerequisite>
              <Prerequisite ok={Boolean(data.summary && data.summary.missing === 0)}>
                Every variant has a cost{data.summary?.missing ? ` (${data.summary.missing} without — ${data.summary.missingUnits} unit(s) will be held unvalued)` : ""}
              </Prerequisite>
              <Prerequisite ok={batch?.status === "APPROVED"}>Costs approved</Prerequisite>
            </ul>
            <p className="text-xs text-ink-500">Run it outside busy hours: while it posts, checkout waits on the products being valued.</p>
          </Card>
          )}
        </div>
      )}

      {batch && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              aria-label="Cost status"
              value={filter}
              onChange={(v) => { setFilter(v); setPage(1); }}
              options={[
                { value: "ALL", label: `All${data?.summary ? ` ${data.summary.lines}` : ""}` },
                { value: "KNOWN", label: `Known${data?.summary ? ` ${data.summary.known}` : ""}` },
                { value: "ESTIMATED", label: `Estimated${data?.summary ? ` ${data.summary.estimated}` : ""}` },
                { value: "MISSING", label: `No cost${data?.summary ? ` ${data.summary.missing}` : ""}`, testId: "filter-missing" },
              ]}
            />
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search SKU or product" wrapperClassName="w-full sm:w-72" />
          </div>
          <Card className="overflow-hidden p-0">
            <HScrollShadow>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>SKU</TableHeaderCell>
                    <TableHeaderCell>Product</TableHeaderCell>
                    <TableHeaderCell align="right">{batch.status === "POSTED" ? "Valued units" : "In stock"}</TableHeaderCell>
                    <TableHeaderCell align="right">Unit cost</TableHeaderCell>
                    <TableHeaderCell align="right">Value</TableHeaderCell>
                    <TableHeaderCell>Cost</TableHeaderCell>
                    <TableHeaderCell />
                  </tr>
                </TableHead>
                <tbody>
                  {lines.isLoading && <TableSkeleton rows={6} cols={7} />}
                  {lines.isError && <TableMessageRow colSpan={7}>The lines couldn&apos;t be loaded. <Button size="sm" variant="ghost" onClick={() => lines.refetch()}>Retry</Button></TableMessageRow>}
                  {lines.data?.lines.length === 0 && <TableMessageRow colSpan={7}>No variants match.</TableMessageRow>}
                  {lines.data?.lines.map((l) => {
                    const qty = l.postedQuantity ?? l.draftQuantity;
                    const value = l.postedValue ?? (l.unitCost === null ? null : Math.max(qty, 0) * l.unitCost);
                    return (
                      <TableRow key={l.id} data-testid="cutover-line">
                        <TableCell className="whitespace-nowrap font-mono text-xs">{l.sku}</TableCell>
                        <TableCell className="min-w-48 text-sm">{l.name}</TableCell>
                        <TableCell align="right" className={qty < 0 ? "tabular-nums text-danger-700" : "tabular-nums"}>{qty}</TableCell>
                        <TableCell align="right" className="tabular-nums">{l.unitCost === null ? "—" : formatPrice(l.unitCost)}</TableCell>
                        <TableCell align="right" className="tabular-nums">{value === null ? "unvalued" : formatPrice(value)}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_BADGE[l.valuationStatus]}>{STATUS_LABEL[l.valuationStatus]}</Badge>
                          <span className="block text-xs text-ink-500">{SOURCE_LABEL[l.costSource]}{l.evidence ? ` · ${l.evidence}` : ""}</span>
                        </TableCell>
                        <TableCell align="right">{editable && <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>Set cost</Button>}</TableCell>
                      </TableRow>
                    );
                  })}
                </tbody>
              </Table>
            </HScrollShadow>
          </Card>
          {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
        </div>
      )}

      {editing && <LineModal line={editing} onClose={() => setEditing(null)} onDone={() => { refresh(); setEditing(null); }} />}
      {dialog === "approve" && data?.summary && <ApproveModal missing={data.summary.missing} missingUnits={data.summary.missingUnits} onClose={() => setDialog(null)} onDone={() => { refresh(); setDialog(null); }} />}
      {dialog === "reopen" && <ReopenModal onClose={() => setDialog(null)} onDone={() => { refresh(); setDialog(null); }} />}
      {dialog === "opening" && batch && <OpeningErrorModal amount={batch.openingErrorAmount} reason={batch.openingErrorReason} onClose={() => setDialog(null)} onDone={() => { refresh(); setDialog(null); }} />}
      {dialog === "post" && <PostModal adjustment={data?.preview?.adjustment ?? 0} onClose={() => setDialog(null)} onDone={() => { refresh(); setDialog(null); }} />}
    </div>
  );
}

function Figure({ label, value, hint, strong, testId }: { label: string; value: string; hint?: string; strong?: boolean; testId?: string }) {
  return (
    <div>
      <dt className="text-ink-600">{label}</dt>
      <dd className={strong ? "text-base font-semibold tabular-nums text-ink-900" : "tabular-nums text-ink-900"} data-testid={testId}>{value}</dd>
      {hint && <dd className="text-xs text-ink-500">{hint}</dd>}
    </div>
  );
}

function Prerequisite({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-label="done" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-label="to do" />}
      <span className={ok ? "text-ink-700" : "text-ink-900"}>{children}</span>
    </li>
  );
}

function PostedSummary({ summary: s }: { summary: NonNullable<financeApi.CutoverBatch["summary"]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4" data-testid="cutover-posted-summary">
      <Figure label="Variants valued" value={String(s.variants)} hint={`${s.known} known · ${s.estimated} estimated · ${s.missing} without cost`} />
      <Figure label="Valuation" value={formatPrice(s.valuation)} hint={s.unvaluedUnits ? `${s.unvaluedUnits} unit(s) held unvalued` : undefined} />
      <Figure label="True-up" value={formatPrice(s.adjustment)} hint={`${formatPrice(s.toCostAdjustments)} to cost adjustments${s.toOpeningBalanceEquity ? ` · ${formatPrice(s.toOpeningBalanceEquity)} to opening equity` : ""}`} />
      <Figure label="Costing active since" value={new Date(s.activatedAt).toLocaleString()} />
    </dl>
  );
}

function LineModal({ line, onClose, onDone }: { line: CutoverLine; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<CutoverValuationStatus>(line.valuationStatus);
  const [cost, setCost] = useState(line.unitCost === null ? "" : String(line.unitCost));
  const [source, setSource] = useState<Exclude<CutoverCostSource, "ADDED_AT_POST">>(line.costSource === "ADDED_AT_POST" ? "OWNER" : line.costSource);
  const [evidence, setEvidence] = useState(line.evidence ?? "");
  const missing = status === "MISSING";
  const amount = Number(cost);
  const invalid = (!missing && (cost.trim() === "" || !Number.isFinite(amount) || amount < 0)) || (status === "KNOWN" && evidence.trim().length < 2);
  const save = useMutation({
    mutationFn: () => financeApi.updateCutoverLines([{ variantId: line.variantId, valuationStatus: status, unitCost: missing ? null : amount, costSource: missing ? "NONE" : source === "NONE" ? "OWNER" : source, evidence: evidence.trim() || null }]),
    onSuccess: () => { toast.success(`${line.sku} updated`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The cost couldn't be saved")),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Set unit cost"
      description={`${line.sku} — ${line.name}`}
      widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={invalid} onClick={() => save.mutate()} data-testid="save-line">Save</Button></>}
    >
      <div className="space-y-4">
        <Field htmlFor="cut-status" label="How sure is this cost?">
          <Select id="cut-status" value={status} onChange={(e) => setStatus(e.target.value as CutoverValuationStatus)}>
            <option value="KNOWN">Known — backed by an invoice or count sheet</option>
            <option value="ESTIMATED">Estimated — a best guess</option>
            <option value="MISSING">No cost — hold the units unvalued</option>
          </Select>
        </Field>
        {!missing && (
          <>
            <Field htmlFor="cut-cost" label="Unit cost" required>
              <Input id="cut-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
            <Field htmlFor="cut-source" label="Source">
              <Select id="cut-source" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                {(["SUPPLIER_INVOICE", "OPENING_COUNT", "OWNER", "CATALOG_VARIANT", "CATALOG_PRODUCT"] as const).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
              </Select>
            </Field>
          </>
        )}
        <Field htmlFor="cut-evidence" label="Evidence" required={status === "KNOWN"} hint="Invoice number, count sheet or note — required for a known cost.">
          <Input id="cut-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={500} />
        </Field>
      </div>
    </Modal>
  );
}

function ApproveModal({ missing, missingUnits, onClose, onDone }: { missing: number; missingUnits: number; onClose: () => void; onDone: () => void }) {
  const [ack, setAck] = useState(false);
  const approve = useMutation({
    mutationFn: () => financeApi.approveCutover(ack),
    onSuccess: () => { toast.success("Costs approved — the cutover can be posted"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The cutover couldn't be approved")),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Approve the cutover costs"
      widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={approve.isPending} disabled={missing > 0 && !ack} onClick={() => approve.mutate()} data-testid="confirm-approve">Approve</Button></>}
    >
      <div className="space-y-3 text-sm text-ink-700">
        <p>Approving freezes every line. To change a cost afterwards, send the cutover back to draft.</p>
        {missing > 0 && (
          <label className="flex items-start gap-2">
            <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="ack-missing" />
            <span>{missing} variant(s) have no cost. Their {missingUnits} unit(s) will be held <strong>unvalued</strong> — never at zero — until a receipt gives them a cost.</span>
          </label>
        )}
      </div>
    </Modal>
  );
}

function ReopenModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const reopen = useMutation({
    mutationFn: () => financeApi.reopenCutover(reason.trim()),
    onSuccess: () => { toast.success("Back to draft"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The cutover couldn't be reopened")),
  });
  return (
    <Modal open onClose={onClose} title="Send back to draft" widthClassName="max-w-md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={reopen.isPending} disabled={reason.trim().length < 3} onClick={() => reopen.mutate()}>Back to draft</Button></>}>
      <Field htmlFor="reopen-reason" label="Why?" required>
        <Textarea id="reopen-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Field>
    </Modal>
  );
}

function OpeningErrorModal({ amount, reason, onClose, onDone }: { amount: number; reason: string | null; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState(amount ? String(amount) : "");
  const [why, setWhy] = useState(reason ?? "");
  const n = value.trim() === "" ? 0 : Number(value);
  const save = useMutation({
    mutationFn: () => financeApi.updateCutoverSettings({ openingErrorAmount: n, openingErrorReason: n ? why.trim() : null }),
    onSuccess: () => { toast.success("Saved"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "Couldn't save")),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Opening-balance error"
      description="Normally the whole true-up goes to inventory cost adjustments. Enter the part that corrects a proven mistake in the opening inventory — it goes to opening balance equity instead."
      widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!Number.isFinite(n) || (n !== 0 && why.trim().length < 3)} onClick={() => save.mutate()}>Save</Button></>}
    >
      <div className="space-y-4">
        <Field htmlFor="oe-amount" label="Amount" hint="Positive when the opening inventory was understated. Leave empty for none.">
          <Input id="oe-amount" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field htmlFor="oe-reason" label="What was wrong at opening?" required={n !== 0}>
          <Textarea id="oe-reason" value={why} onChange={(e) => setWhy(e.target.value)} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}

function PostModal({ adjustment, onClose, onDone }: { adjustment: number; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const post = useMutation({
    mutationFn: () => financeApi.postCutover(),
    onSuccess: () => { toast.success("Cutover posted — inventory costing is active"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The cutover couldn't be posted")),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Post the valuation cutover"
      widthClassName="max-w-md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" loading={post.isPending} disabled={typed !== "POST"} onClick={() => post.mutate()} data-testid="confirm-post">Post and activate costing</Button></>}
    >
      <div className="space-y-3 text-sm text-ink-700">
        <p>This values the stock on hand right now at the approved costs, posts a true-up of about <strong>{formatPrice(adjustment)}</strong> to the inventory account, and switches inventory costing on for good. It can&apos;t be undone.</p>
        <Field htmlFor="post-confirm" label='Type "POST" to confirm'>
          <Input id="post-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="post-confirm-input" />
        </Field>
      </div>
    </Modal>
  );
}
