"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as purchasingApi from "@/lib/api/purchasing";
import { PermissionState } from "@/components/admin/permission-state";

/** A percentage 0–100 with at most 4 decimals — checked as text (the API stores it as a decimal, never a float). */
const PERCENT = /^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/;
const percentError = (v: string) => (v.trim() === "" || PERCENT.test(v.trim()) ? undefined : "Enter 0–100, at most 4 decimals");

/** Purchase tax codes (docs/FINANCE_PHASE_4.md §19): a rate and the share of it you can recover. No country rules are
 * built in. A code's rate and recoverable share never change — a new rate is a new code; old codes are deactivated. */
export default function TaxCodesPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("purchasing.view");
  const list = useQuery({ queryKey: purchasingApi.purchasingKeys.taxCodes(), queryFn: () => purchasingApi.listTaxCodes(), enabled: allowed });
  const status = useQuery({ queryKey: purchasingApi.purchasingKeys.status(), queryFn: purchasingApi.purchasingStatus, enabled: allowed });
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ code: "", name: "", rate: "", recoverablePct: "100", description: "" });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: purchasingApi.purchasingKeys.all });

  const create = useMutation({
    mutationFn: () => purchasingApi.createTaxCode({ code: f.code.trim(), name: f.name.trim(), rate: f.rate.trim(), recoverablePct: f.recoverablePct.trim(), description: f.description }),
    onSuccess: (t) => { refresh(); setCreating(false); toast.success(`Tax code ${t.code} added`); },
    onError: (err) => toast.error(getErrorMessage(err, "The tax code couldn't be added")),
  });
  const toggle = useMutation({
    mutationFn: (t: purchasingApi.TaxCode) => purchasingApi.updateTaxCode(t.id, { isActive: !t.isActive }),
    onSuccess: (t) => { refresh(); toast.success(`${t.code} ${t.isActive ? "activated" : "deactivated"}`); },
    onError: (err) => toast.error(getErrorMessage(err, "The tax code couldn't be changed")),
  });
  const setup = useMutation({
    mutationFn: purchasingApi.setupPurchasing,
    onSuccess: (r) => { refresh(); toast.success(r.changes.length ? `Set up: ${r.changes.length} change(s)` : "Already set up"); },
    onError: (err) => toast.error(getErrorMessage(err, "Set-up failed")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <PermissionState icon={Percent} page="Purchasing" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Purchase tax codes"
        description="Rates used on purchases. The recoverable share goes to input VAT; the rest becomes part of the cost. A rate never changes — add a new code and deactivate the old one."
        action={can("finance.configure") && <Button size="sm" onClick={() => { setF({ code: "", name: "", rate: "", recoverablePct: "100", description: "" }); setCreating(true); }} data-testid="new-tax-code"><Plus className="h-4 w-4" /> New tax code</Button>}
      />
      {status.data && !status.data.readiness.ready && (
        <Alert variant="warning" title="Purchasing accounts not set up">
          Missing: {status.data.readiness.missing.join(", ")}.{" "}
          {can("finance.configure") && <Button size="sm" variant="outline" loading={setup.isPending} onClick={() => setup.mutate()}>Set up now</Button>}
        </Alert>
      )}
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell align="right">Rate</TableHeaderCell>
                <TableHeaderCell align="right">Recoverable</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell />
              </tr>
            </TableHead>
            <tbody>
              {list.data?.taxCodes.map((t) => (
                <TableRow key={t.id} data-testid="tax-code-row">
                  <TableCell className="whitespace-nowrap font-mono text-xs">{t.code}</TableCell>
                  <TableCell>{t.name}{t.description && <span className="block text-xs text-ink-500">{t.description}</span>}</TableCell>
                  <TableCell align="right" className="tabular-nums">{t.rate}%</TableCell>
                  <TableCell align="right" className="tabular-nums">{t.recoverablePct}%</TableCell>
                  <TableCell><Badge variant={t.isActive ? "success" : "neutral"}>{t.isActive ? "active" : "inactive"}</Badge></TableCell>
                  <TableCell align="right">
                    {can("finance.configure") && <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === t.id} onClick={() => toggle.mutate(t)}>{t.isActive ? "Deactivate" : "Activate"}</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
        {list.data?.taxCodes.length === 0 && <EmptyState icon={Percent} title="No tax codes yet" />}
      </Card>

      {creating && (
        <Modal
          open
          onClose={() => setCreating(false)}
          title="New tax code"
          widthClassName="max-w-lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              <Button loading={create.isPending} disabled={!f.code.trim() || f.name.trim().length < 2 || !f.rate.trim() || Boolean(percentError(f.rate) || percentError(f.recoverablePct))} onClick={() => create.mutate()} data-testid="save-tax-code">Add</Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field htmlFor="tc-code" label="Code" required>
              <Input id="tc-code" value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value }))} maxLength={24} placeholder="VAT15" />
            </Field>
            <Field htmlFor="tc-name" label="Name" required>
              <Input id="tc-name" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} maxLength={120} />
            </Field>
            <Field htmlFor="tc-rate" label="Rate (%)" required error={percentError(f.rate)}>
              <Input id="tc-rate" inputMode="decimal" value={f.rate} onChange={(e) => setF((x) => ({ ...x, rate: e.target.value }))} />
            </Field>
            <Field htmlFor="tc-rec" label="Recoverable (%)" required hint="100 = fully reclaimable input VAT; 0 = all of it is cost." error={percentError(f.recoverablePct)}>
              <Input id="tc-rec" inputMode="decimal" value={f.recoverablePct} onChange={(e) => setF((x) => ({ ...x, recoverablePct: e.target.value }))} />
            </Field>
          </div>
          <Field htmlFor="tc-desc" label="Description">
            <Input id="tc-desc" value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} maxLength={500} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
