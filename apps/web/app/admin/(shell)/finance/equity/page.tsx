"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { Partner } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Partners & equity (docs/FINANCE_EQUITY.md): each partner's capital and current account, read from the ledger, and the
 * balance sheet's equity. Profit sharing and capital rules wait for the signed partner agreement (B-2). */
export default function EquityPage() {
  const { can, ready } = useCapabilities();
  const allowed = can("finance.sensitive");
  const q = useQuery({ queryKey: financeApi.equityKeys.overview(), queryFn: () => financeApi.getEquity(), enabled: allowed });
  const [editing, setEditing] = useState<Partner | "new" | null>(null);
  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Handshake} title="Partners & equity aren't available to your role" description="Ownership balances are visible only to the owner." />
      </div>
    );
  }
  const d = q.data;
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Partners & equity"
        description="What each partner has put in and taken out, and the business's equity as the balance sheet shows it."
        action={can("finance.configure") && <Button size="sm" onClick={() => setEditing("new")} data-testid="new-partner"><Plus className="h-4 w-4" /> Add partner</Button>}
      />
      <Alert variant="info" title="Profit sharing waits for the signed agreement">
        Shares below are notes, not rules — nothing is divided until the partners sign. Money a partner puts in or takes out is a deposit or withdrawal in{" "}
        <Link href="/admin/finance/accounts" className="font-medium underline underline-offset-2">Money accounts</Link> against their capital or current account.
      </Alert>
      {q.isLoading && <Skeleton className="h-64 w-full" />}
      {q.isError && <Alert variant="danger" title="Equity couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>}
      {d && (
        <>
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Card className="p-4"><dt className="text-sm text-ink-600">Total equity</dt><dd className="text-lg font-semibold tabular-nums text-ink-900" data-testid="equity-total">{formatPrice(d.equity.total)}</dd><dd className="text-xs text-ink-500">as of {d.asOf}</dd></Card>
            <Card className="p-4"><dt className="text-sm text-ink-600">Partners&apos; capital</dt><dd className="text-lg font-semibold tabular-nums text-ink-900">{formatPrice(d.totals.capital)}</dd></Card>
            <Card className="p-4"><dt className="text-sm text-ink-600">Partners&apos; current accounts</dt><dd className="text-lg font-semibold tabular-nums text-ink-900">{formatPrice(d.totals.current)}</dd><dd className="text-xs text-ink-500">negative = drawn more than credited</dd></Card>
          </dl>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-ink-900">Partners</h2>
            {d.partners.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {d.partners.map((p) => (
                  <Card key={p.id} className="space-y-3 p-4" data-testid="partner-card">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900"><span className="font-mono text-xs text-ink-500">{p.number}</span> {p.name}</p>
                        <p className="text-xs text-ink-500">Since {p.joinedOn}{p.leftOn ? ` · left ${p.leftOn}` : ""}{p.phone ? ` · ${p.phone}` : ""}</p>
                      </div>
                      {p.agreedSharePct !== null && <Badge variant="warning" title="Not confirmed until the agreement is signed">{p.agreedSharePct}% · unconfirmed</Badge>}
                    </div>
                    <dl className="grid grid-cols-3 gap-2 text-sm">
                      <div><dt className="text-xs text-ink-500">Capital</dt><dd className="tabular-nums text-ink-900">{formatPrice(p.balances.capital)}</dd></div>
                      <div><dt className="text-xs text-ink-500">Current</dt><dd className={cn("tabular-nums", p.balances.current < 0 ? "text-danger-700" : "text-ink-900")}>{formatPrice(p.balances.current)}</dd></div>
                      <div><dt className="text-xs text-ink-500">Total</dt><dd className="font-medium tabular-nums text-ink-900">{formatPrice(p.balances.total)}</dd></div>
                    </dl>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                      <Link href={`/admin/finance/ledger?account=${p.capitalAccount.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{p.capitalAccount.code} ledger</Link>
                      <Link href={`/admin/finance/ledger?account=${p.currentAccount.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{p.currentAccount.code} ledger</Link>
                      {can("finance.configure") && <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditing(p)}>Edit</Button>}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState icon={Handshake} title="No partners recorded" description="Add each partner to give them their own capital and current accounts." />
            )}
            {d.partners.length > 0 && d.totals.agreedSharesPct !== 100 && d.totals.agreedSharesPct !== 0 && (
              <p className="text-sm text-warning-700">The shares noted add up to {d.totals.agreedSharesPct}%, not 100%.</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-ink-900">Equity on the balance sheet</h2>
            <Card className="divide-y divide-line p-0 text-sm">
              {d.equity.lines.map((l, i) => (
                <div key={l.accountId ?? `line-${i}`} className="flex justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 text-ink-700"><span className="font-mono text-xs text-ink-500">{l.code}</span> {l.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-900">{l.amount === null ? "restricted" : formatPrice(l.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 px-4 py-2.5 font-semibold"><span>Total equity</span><span className="tabular-nums">{formatPrice(d.equity.total)}</span></div>
            </Card>
          </section>
        </>
      )}
      {editing && <PartnerModal partner={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PartnerModal({ partner, onClose }: { partner: Partner | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: partner?.name ?? "", phone: partner?.phone ?? "", email: partner?.email ?? "", joinedOn: partner?.joinedOn ?? "", leftOn: partner?.leftOn ?? "",
    agreedSharePct: partner?.agreedSharePct === null || partner?.agreedSharePct === undefined ? "" : String(partner.agreedSharePct), agreementReference: partner?.agreementReference ?? "", notes: partner?.notes ?? "",
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const share = form.agreedSharePct === "" ? null : Number(form.agreedSharePct);
  const valid = form.name.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(form.joinedOn) && (!form.leftOn || form.leftOn >= form.joinedOn) && (share === null || (share >= 0 && share <= 100));
  const save = useMutation({
    mutationFn: () => financeApi.savePartner(partner?.id ?? null, { ...form, name: form.name.trim(), leftOn: form.leftOn || null, agreedSharePct: share }),
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(partner ? `${p.name} saved` : `${p.name} added — accounts ${p.capitalAccount.code} and ${p.currentAccount.code}`); onClose(); },
    onError: (err) => toast.error(getErrorMessage(err, "The partner couldn't be saved")),
  });
  return (
    <Modal open onClose={onClose} title={partner ? `Edit ${partner.name}` : "Add partner"} widthClassName="max-w-lg"
      description={partner ? "Renaming also renames their two accounts." : "Their capital (31xx) and current (32xx) accounts are created with them."}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()} data-testid="save-partner">Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field htmlFor="pt-name" label="Name" required className="sm:col-span-2"><Input id="pt-name" value={form.name} onChange={set("name")} maxLength={120} /></Field>
        <Field htmlFor="pt-phone" label="Phone"><Input id="pt-phone" value={form.phone} onChange={set("phone")} maxLength={30} /></Field>
        <Field htmlFor="pt-email" label="Email"><Input id="pt-email" type="email" value={form.email} onChange={set("email")} maxLength={160} /></Field>
        <Field htmlFor="pt-joined" label="Partner since" required><Input id="pt-joined" type="date" value={form.joinedOn} onChange={set("joinedOn")} /></Field>
        <Field htmlFor="pt-left" label="Left on"><Input id="pt-left" type="date" value={form.leftOn} onChange={set("leftOn")} /></Field>
        <Field htmlFor="pt-share" label="Share discussed (%)" hint="A note — unconfirmed until signed"><Input id="pt-share" inputMode="decimal" value={form.agreedSharePct} onChange={set("agreedSharePct")} /></Field>
        <Field htmlFor="pt-ref" label="Agreement reference"><Input id="pt-ref" value={form.agreementReference} onChange={set("agreementReference")} maxLength={200} placeholder="Draft v2 (unsigned)" /></Field>
        <Field htmlFor="pt-notes" label="Notes" className="sm:col-span-2"><Textarea id="pt-notes" value={form.notes} onChange={set("notes")} rows={2} maxLength={1000} /></Field>
      </div>
    </Modal>
  );
}
