"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { PayRun, Payslip } from "@/lib/api/finance";
import * as settingsApi from "@/lib/api/settings";
import { formatPrice } from "@/lib/format";

const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** Printable payslips of a pay run (docs/FINANCE_PAYROLL.md) — all of them, or one with ?slip=<id>. A sibling of
 * admin/(shell) like the order invoice, so it prints as a standalone document. The API enforces finance.sensitive. */
export default function PayslipsPrintPage() {
  const { id } = useParams<{ id: string }>();
  const slipId = useSearchParams().get("slip");
  const router = useRouter();
  const run = useQuery({ queryKey: financeApi.payrollKeys.run(id), queryFn: () => financeApi.getPayRun(id) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.getSettings });
  const storeName = settings.data?.settings?.storeName ?? "";

  if (run.isLoading) {
    return (
      <div className="mx-auto max-w-3xl animate-pulse space-y-4 p-6 sm:p-10">
        <div className="h-6 w-40 rounded bg-ink-100" />
        <div className="h-64 w-full rounded bg-ink-100" />
      </div>
    );
  }
  if (run.isError || !run.data) {
    return (
      <div className="mx-auto max-w-3xl p-6 sm:p-10">
        <Alert variant="danger" title="The payslips couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => run.refetch()}>Retry</Button>}>{getErrorMessage(run.error, "")}</Alert>
      </div>
    );
  }
  const r = run.data;
  const slips = slipId ? r.payslips.filter((p) => p.id === slipId) : r.payslips;
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-10">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <button type="button" onClick={() => router.back()} className="flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
          <ArrowLeft size={16} /> Back
        </button>
        <Button onClick={() => window.print()} size="sm" disabled={!slips.length} data-testid="print-payslips">
          <Printer size={14} /> Print {slips.length === 1 ? "payslip" : `${slips.length} payslips`}
        </Button>
      </div>
      {!slips.length && <Alert variant="neutral" title="No payslips to print">This pay run has no payslips{slipId ? " with that id" : ""}.</Alert>}
      <div className="space-y-8 print:space-y-0">
        {slips.map((p) => <PayslipDocument key={p.id} run={r} slip={p} storeName={storeName} />)}
      </div>
    </div>
  );
}

function PayslipDocument({ run, slip, storeName }: { run: PayRun; slip: Payslip; storeName: string }) {
  const earnings = slip.lines.filter((l) => l.kind === "EARNING");
  const deductions = slip.lines.filter((l) => l.kind === "DEDUCTION");
  const employer = slip.lines.filter((l) => l.kind === "EMPLOYER_CONTRIBUTION");
  const paid = slip.payment.status === "PAID" ? `Paid ${slip.payment.movement?.date ?? ""}${slip.payment.movement?.from ? ` from ${slip.payment.movement.from}` : ""}` : slip.payment.status === "AWAITING_APPROVAL" ? "Payment awaiting approval" : "Not paid yet";
  return (
    <article className="border border-ink-200 bg-surface p-5 sm:p-8 print:break-after-page print:border-0" data-testid="payslip-document">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-ink-100 pb-5">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{storeName}</h1>
          <p className="text-sm text-ink-500">Payslip · {monthLabel(run.periodKey)}</p>
        </div>
        <div className="text-sm text-ink-500 sm:text-right">
          <p>{run.number}</p>
          <p>Pay date {run.payDate}</p>
          {run.status !== "POSTED" && <p className="font-semibold uppercase tracking-wide text-warning-700">{run.status === "DRAFT" ? "Draft — not final" : "Reversed"}</p>}
        </div>
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-400">Employee</dt>
          <dd className="font-medium text-ink-900">{slip.employee.name}</dd>
          <dd className="text-ink-600">{slip.employee.number}{slip.employee.designation ? ` · ${slip.employee.designation}` : ""}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-400">Days paid</dt>
          <dd className="text-ink-900">{slip.daysPayable} of {slip.daysInPeriod}</dd>
          {slip.employee.payoutDetails && <dd className="text-ink-600">Paid to {slip.employee.payoutDetails}</dd>}
        </div>
      </dl>

      <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
        <Section title="Earnings" lines={earnings} total={slip.gross} totalLabel="Gross pay" />
        <Section title="Deductions" lines={deductions} total={slip.deductions} totalLabel="Total deductions" />
      </div>

      <div className="mt-6 flex items-center justify-between border-y border-ink-200 py-3">
        <span className="font-semibold text-ink-900">Net pay</span>
        <span className="text-lg font-semibold tabular-nums text-ink-900" data-testid="payslip-net">{formatPrice(slip.net)}</span>
      </div>
      <p className="mt-2 text-sm text-ink-600">{paid}</p>

      {employer.length > 0 && (
        <div className="mt-6 text-xs text-ink-500">
          <p className="mb-1 uppercase tracking-wide">Paid by the employer on top of your pay</p>
          {employer.map((l) => <p key={l.componentId} className="flex justify-between gap-2"><span>{l.name}</span><span className="tabular-nums">{formatPrice(l.amount)}</span></p>)}
        </div>
      )}
    </article>
  );
}

function Section({ title, lines, total, totalLabel }: { title: string; lines: Payslip["lines"]; total: number; totalLabel: string }) {
  return (
    <section className="text-sm">
      <h2 className="mb-2 text-xs uppercase tracking-wide text-ink-400">{title}</h2>
      {lines.length ? lines.map((l) => (
        <p key={l.componentId} className="flex justify-between gap-2 py-0.5"><span className="text-ink-700">{l.name}</span><span className="tabular-nums text-ink-900">{formatPrice(l.amount)}</span></p>
      )) : <p className="text-ink-500">None</p>}
      <p className="mt-1 flex justify-between gap-2 border-t border-ink-100 pt-1 font-medium"><span>{totalLabel}</span><span className="tabular-nums">{formatPrice(total)}</span></p>
    </section>
  );
}
