"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileStack, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { ReasonModal } from "@/components/admin/purchasing/reason-modal";
import { useCapabilities } from "@/hooks/use-capability";
import { useCreateParam } from "@/hooks/use-create-param";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { ChartAccount, JournalEntry } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";
import { PermissionState } from "@/components/admin/permission-state";

const KIND_LABEL: Record<JournalEntry["kind"], string> = { MANUAL: "Manual", OPENING_BALANCE: "Opening balances", EVENT: "Automatic", REVERSAL: "Reversal", CORRECTION: "Correction", TREASURY: "Money movement", ADJUSTMENT: "Adjustment" };

/** Journals (docs/FINANCE_STATEMENTS.md): every entry in the books — automatic ones from sales, purchases, production and
 * money movements, and manual ones entered here. A posted entry never changes; it is reversed. */
export default function JournalsPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("finance.view");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [creating, setCreating] = useState(false);
  useCreateParam("journal", () => setCreating(true));
  const [reversing, setReversing] = useState<JournalEntry | null>(null);
  const [correcting, setCorrecting] = useState<JournalEntry | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = { status: status || undefined, kind: kind || undefined, from: from || undefined, to: to || undefined, pageSize: 100 };
  const list = useQuery({ queryKey: financeApi.ledgerKeys.journals(query), queryFn: () => financeApi.listJournals(query), enabled: allowed });
  const chart = useQuery({ queryKey: financeApi.ledgerKeys.chart(), queryFn: financeApi.listChart, enabled: allowed });
  const accountById = useMemo(() => new Map((chart.data?.accounts ?? []).map((a) => [a.id, a])), [chart.data]);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["finance"] });
  const post = useMutation({ mutationFn: financeApi.postJournal, onSuccess: () => { refresh(); toast.success("Journal posted"); }, onError: (err) => toast.error(getErrorMessage(err, "The journal couldn't be posted")) });
  const remove = useMutation({ mutationFn: financeApi.deleteJournal, onSuccess: () => { refresh(); toast.success("Draft deleted"); }, onError: (err) => toast.error(getErrorMessage(err, "The draft couldn't be deleted")) });
  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => financeApi.reverseJournal(id, reason),
    onSuccess: () => { refresh(); setReversing(null); toast.success("Journal reversed"); },
    onError: (err) => toast.error(getErrorMessage(err, "The journal couldn't be reversed")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <PermissionState icon={FileStack} page="Journals" />
      </div>
    );
  }
  const filtered = Boolean(status || kind || from || to);
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Journals"
        description="Every entry in the books. Automatic entries come from sales, purchases, production and money movements; enter anything else here."
        action={can("finance.transact") && <Button size="sm" onClick={() => setCreating(true)} data-testid="new-journal"><Plus className="h-4 w-4" /> Manual journal</Button>}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-[calc(50%-6px)] sm:w-36">
          <option value="">Posted and drafts</option>
          <option value="POSTED">Posted</option>
          <option value="DRAFT">Drafts</option>
        </Select>
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-[calc(50%-6px)] sm:w-44">
          <option value="">Every kind</option>
          {(Object.keys(KIND_LABEL) as JournalEntry["kind"][]).filter((k) => k !== "ADJUSTMENT").map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </Select>
        <Field htmlFor="j-from" label="From" className="w-[calc(50%-6px)] sm:w-40"><Input id="j-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field htmlFor="j-to" label="To" className="w-[calc(50%-6px)] sm:w-40"><Input id="j-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {list.isLoading && <Skeleton className="h-48 w-full" />}
      {list.isError && <Alert variant="danger" title="Journals couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => list.refetch()}>Retry</Button>}>{getErrorMessage(list.error, "")}</Alert>}
      {list.data?.journals.length === 0 && <EmptyState icon={FileStack} title={filtered ? "Nothing matches" : "No journals yet"} description={filtered ? "Try other filters." : "Entries appear as the business trades."} />}
      <div className="space-y-2">
        {list.data?.journals.map((j) => {
          const expanded = openId === j.id;
          return (
            <Card key={j.id} className="p-0" data-testid="journal-card">
              <button type="button" onClick={() => setOpenId(expanded ? null : j.id)} className="flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left" aria-expanded={expanded}>
                <span className="min-w-0">
                  <span className="text-sm text-ink-900">{j.number ? `#${j.number} ` : ""}{j.description}</span>
                  <span className="block text-xs text-ink-500">{j.entryDate} · {KIND_LABEL[j.kind] ?? j.kind}{j.reference ? ` · ${j.reference}` : ""}</span>
                </span>
                <span className="flex items-center gap-2"><span className="text-sm tabular-nums text-ink-900">{formatPrice(j.totalDebit)}</span><Badge variant={j.status === "POSTED" ? "success" : "neutral"}>{j.status === "POSTED" ? "posted" : "draft"}</Badge></span>
              </button>
              {expanded && (
                <div className="space-y-3 border-t border-line px-4 py-3">
                  <ul className="space-y-1 text-sm">
                    {j.lines.map((l) => {
                      const a = accountById.get(l.accountId);
                      return (
                        <li key={l.id} className="flex flex-wrap justify-between gap-2">
                          <span className="min-w-0"><span className="font-mono text-xs text-ink-500">{a?.code ?? ""}</span> {a?.name ?? "Restricted account"}{l.memo ? <span className="text-ink-500"> · {l.memo}</span> : null}</span>
                          <span className="tabular-nums text-ink-700">{l.debit ? `Dr ${formatPrice(l.debit)}` : `Cr ${formatPrice(l.credit)}`}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {j.reason && <p className="text-xs text-ink-500">Reason: {j.reason}</p>}
                  <div className="flex flex-wrap gap-2">
                    {j.status === "DRAFT" && can("finance.post") && <Button size="sm" loading={post.isPending} onClick={() => post.mutate(j.id)}>Post</Button>}
                    {j.status === "DRAFT" && can("finance.transact") && <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(j.id)}>Delete draft</Button>}
                    {j.status === "POSTED" && j.kind === "MANUAL" && !j.reversedBy && can("finance.reverse") && <Button size="sm" variant="outline" onClick={() => setReversing(j)}>Reverse</Button>}
                    {j.status === "POSTED" && j.kind === "MANUAL" && !j.reversedBy && can("finance.reverse") && !j.lines.some((l) => l.debit === null || l.credit === null) && <Button size="sm" variant="outline" onClick={() => setCorrecting(j)} data-testid="correct-journal">Correct</Button>}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {creating && <JournalModal accounts={chart.data?.accounts ?? []} canPost={can("finance.post")} onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); }} />}
      {correcting && <JournalModal accounts={chart.data?.accounts ?? []} canPost correcting={correcting} onClose={() => setCorrecting(null)} onDone={() => { setCorrecting(null); refresh(); }} />}
      {reversing && <ReasonModal title={`Reverse journal #${reversing.number}`} hint="A mirror entry is posted; the original stays in the books." loading={reverse.isPending} onClose={() => setReversing(null)} onConfirm={(reason) => reverse.mutate({ id: reversing.id, reason })} />}
    </div>
  );
}

interface Row { key: number; accountId: string; debit: string; credit: string; memo: string }
let seq = 0;
const cents = (v: string) => (v.trim() ? Math.round(Number(v) * 100) : 0);

/** A new manual journal, or — with `correcting` — the corrected version of a posted one: its lines prefilled, a reason
 * required; saving reverses the original and posts the correction in one step. */
function JournalModal({ accounts, canPost, correcting, onClose, onDone }: { accounts: ChartAccount[]; canPost: boolean; correcting?: JournalEntry; onClose: () => void; onDone: () => void }) {
  const postable = accounts.filter((a) => a.isPostable && a.isActive && !a.restricted);
  const [date, setDate] = useState(() => correcting?.entryDate ?? new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState(() => (correcting ? `Correction of #${correcting.number}: ${correcting.description}`.slice(0, 300) : ""));
  const [reference, setReference] = useState(() => correcting?.reference ?? "");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Row[]>(() => correcting
    ? correcting.lines.map((l) => ({ key: ++seq, accountId: l.accountId, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "", memo: l.memo ?? "" }))
    : [{ key: ++seq, accountId: "", debit: "", credit: "", memo: "" }, { key: ++seq, accountId: "", debit: "", credit: "", memo: "" }]);
  const [key] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `jr-${Date.now()}`));
  const set = (k: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const dr = rows.reduce((s, r) => s + cents(r.debit), 0);
  const cr = rows.reduce((s, r) => s + cents(r.credit), 0);
  const rowsOk = rows.every((r) => r.accountId && (cents(r.debit) > 0) !== (cents(r.credit) > 0) && cents(r.debit) >= 0 && cents(r.credit) >= 0);
  const valid = description.trim().length > 0 && rows.length >= 2 && rowsOk && dr === cr && dr > 0 && (!correcting || reason.trim().length >= 3);
  const save = useMutation({
    mutationFn: async (andPost: boolean) => {
      if (correcting) {
        await financeApi.correctJournal(correcting.id, { reason: reason.trim(), entryDate: date, description: description.trim(), lines: rows.map((x) => ({ accountId: x.accountId, debit: cents(x.debit) / 100, credit: cents(x.credit) / 100, memo: x.memo.trim() || null })) });
        return true;
      }
      const r = await financeApi.createJournal({ entryDate: date, description: description.trim(), reference: reference.trim() || null, lines: rows.map((x) => ({ accountId: x.accountId, debit: cents(x.debit) / 100, credit: cents(x.credit) / 100, memo: x.memo.trim() || null })) }, key);
      if (andPost) await financeApi.postJournal(r.journal.id);
      return andPost;
    },
    onSuccess: (posted) => { toast.success(correcting ? `Journal #${correcting.number} corrected` : posted ? "Journal posted" : "Draft saved"); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The journal couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={correcting ? `Correct journal #${correcting.number}` : "Manual journal"} widthClassName="max-w-3xl"
      description={correcting ? "The original is reversed and this corrected entry is posted, both on the date below. Both stay in the books." : "Debits must equal credits. A draft can be checked by someone else before posting."}
      footer={correcting
        ? <><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate(true)} data-testid="journal-correct">Reverse and post correction</Button></>
        : <><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="outline" loading={save.isPending} disabled={!valid} onClick={() => save.mutate(false)}>Save draft</Button>{canPost && <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate(true)} data-testid="journal-post">Post</Button>}</>}>
      <div className="space-y-4">
        {correcting && <Field htmlFor="jr-reason" label="Reason for the correction" required><Input id="jr-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Booked to the wrong expense account" /></Field>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field htmlFor="jr-date" label="Date" required><Input id="jr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field htmlFor="jr-desc" label="Description" required className="sm:col-span-2"><Input id="jr-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></Field>
          <Field htmlFor="jr-ref" label="Reference" className="sm:col-span-3"><Input id="jr-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></Field>
        </div>
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.key} className="grid grid-cols-2 gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_110px_110px_auto]">
              <Select aria-label={`Line ${i + 1} account`} value={r.accountId} onChange={(e) => set(r.key, { accountId: e.target.value })} className="col-span-2 sm:col-span-1">
                <option value="">Account…</option>
                {postable.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </Select>
              <Input aria-label={`Line ${i + 1} debit`} placeholder="Debit" inputMode="decimal" value={r.debit} onChange={(e) => set(r.key, { debit: e.target.value, credit: e.target.value ? "" : r.credit })} />
              <Input aria-label={`Line ${i + 1} credit`} placeholder="Credit" inputMode="decimal" value={r.credit} onChange={(e) => set(r.key, { credit: e.target.value, debit: e.target.value ? "" : r.debit })} />
              <IconButton aria-label={`Remove line ${i + 1}`} disabled={rows.length <= 2} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 className="h-4 w-4" /></IconButton>
              <Input aria-label={`Line ${i + 1} memo`} placeholder="Memo (optional)" value={r.memo} onChange={(e) => set(r.key, { memo: e.target.value })} className="col-span-2 sm:col-span-4" />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, { key: ++seq, accountId: "", debit: "", credit: "", memo: "" }])}><Plus className="h-4 w-4" /> Line</Button>
          <p className={dr === cr ? "text-sm tabular-nums text-ink-700" : "text-sm tabular-nums text-danger-700"}>Debits {formatPrice(dr / 100)} · Credits {formatPrice(cr / 100)}{dr !== cr ? ` · off by ${formatPrice(Math.abs(dr - cr) / 100)}` : ""}</p>
        </div>
      </div>
    </Modal>
  );
}
