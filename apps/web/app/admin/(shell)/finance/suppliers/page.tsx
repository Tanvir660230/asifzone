"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Truck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as purchasingApi from "@/lib/api/purchasing";
import type { Supplier, SupplierStatus } from "@/lib/api/purchasing";
import { formatPrice } from "@/lib/format";

const STATUS_BADGE = { ACTIVE: "success", ON_HOLD: "warning", INACTIVE: "neutral" } as const;
const STATUS_LABEL = { ACTIVE: "active", ON_HOLD: "on hold", INACTIVE: "inactive" } as const;

/** Suppliers (docs/FINANCE_PHASE_4.md §7): the businesses goods are bought from. A supplier's code is permanent; a supplier
 * is never deleted — it is put on hold or made inactive, with a reason. What a supplier is owed comes from the books (4E). */
export default function SuppliersPage() {
  const { can, ready } = useCapabilities();
  const queryClient = useQueryClient();
  const allowed = can("suppliers.view");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const query = { q: q.trim() || undefined, status: status || undefined, pageSize: 200 };
  const list = useQuery({ queryKey: purchasingApi.purchasingKeys.suppliers(query), queryFn: () => purchasingApi.listSuppliers(query), enabled: allowed });
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [statusOf, setStatusOf] = useState<{ s: Supplier; to: SupplierStatus } | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: purchasingApi.purchasingKeys.all });

  const changeStatus = useMutation({
    mutationFn: () => purchasingApi.setSupplierStatus(statusOf!.s.id, statusOf!.to, reason.trim() || null),
    onSuccess: (s) => { refresh(); setStatusOf(null); toast.success(`${s.displayName} is ${STATUS_LABEL[s.status]}`); },
    onError: (err) => toast.error(getErrorMessage(err, "The status couldn't be changed")),
  });

  if (ready && !allowed) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={Truck} title="Suppliers aren't available to your role" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader
        title="Suppliers"
        description="The businesses you buy stock and services from. A supplier's code is permanent and a supplier is never deleted — put it on hold or make it inactive instead."
        action={can("suppliers.manage") && <Button size="sm" onClick={() => setEditing("new")} data-testid="new-supplier"><Plus className="h-4 w-4" /> New supplier</Button>}
      />
      <div className="flex flex-wrap gap-3">
        <Input aria-label="Search suppliers" placeholder="Search name, code or phone" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">Every status</option>
          <option value="ACTIVE">Active</option>
          <option value="ON_HOLD">On hold</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      </div>
      <Card className="overflow-hidden p-0">
        <HScrollShadow>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Code</TableHeaderCell>
                <TableHeaderCell>Supplier</TableHeaderCell>
                <TableHeaderCell>Contact</TableHeaderCell>
                <TableHeaderCell align="right">Terms</TableHeaderCell>
                <TableHeaderCell align="right">Credit limit</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell />
              </tr>
            </TableHead>
            <tbody>
              {list.data?.suppliers.map((s) => (
                <TableRow key={s.id} data-testid="supplier-row">
                  <TableCell className="whitespace-nowrap font-mono text-xs">{s.code}</TableCell>
                  <TableCell>
                    {s.displayName}
                    {s.displayName !== s.legalName && <span className="block text-xs text-ink-500">{s.legalName}</span>}
                  </TableCell>
                  <TableCell className="text-sm">{[s.contactName, s.phone].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{s.paymentTermsDays ? `${s.paymentTermsDays} days` : "on receipt"}</TableCell>
                  <TableCell align="right" className="tabular-nums">{s.creditLimit === null ? "—" : formatPrice(s.creditLimit)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                    {s.statusReason && <span className="block text-xs text-ink-500">{s.statusReason}</span>}
                  </TableCell>
                  <TableCell align="right">
                    {can("suppliers.manage") && (
                      <span className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                        {s.status === "ACTIVE" ? (
                          <Button size="sm" variant="ghost" onClick={() => { setReason(""); setStatusOf({ s, to: "ON_HOLD" }); }}>Hold</Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => { setReason(""); setStatusOf({ s, to: "ACTIVE" }); }}>Reactivate</Button>
                        )}
                        {s.status !== "INACTIVE" && <Button size="sm" variant="ghost" onClick={() => { setReason(""); setStatusOf({ s, to: "INACTIVE" }); }}>Deactivate</Button>}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        </HScrollShadow>
        {list.data?.suppliers.length === 0 && <EmptyState icon={Truck} title="No suppliers yet" description="Add the businesses you buy from." />}
      </Card>

      {editing && <SupplierModal supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { refresh(); setEditing(null); }} />}
      {statusOf && (
        <Modal
          open
          onClose={() => setStatusOf(null)}
          title={statusOf.to === "ACTIVE" ? "Reactivate supplier" : statusOf.to === "ON_HOLD" ? "Put supplier on hold" : "Deactivate supplier"}
          description={`${statusOf.s.displayName} (${statusOf.s.code})`}
          widthClassName="max-w-md"
          footer={
            <>
              <Button variant="outline" onClick={() => setStatusOf(null)}>Cancel</Button>
              <Button loading={changeStatus.isPending} disabled={statusOf.to !== "ACTIVE" && reason.trim().length < 3} onClick={() => changeStatus.mutate()} data-testid="confirm-status">Confirm</Button>
            </>
          }
        >
          {statusOf.to !== "ACTIVE" ? (
            <Field htmlFor="st-reason" label="Reason" required>
              <Textarea id="st-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
          ) : (
            <p className="text-sm text-ink-700">New purchases and payments to this supplier will be allowed again.</p>
          )}
        </Modal>
      )}
    </div>
  );
}

const blank = { code: "", legalName: "", displayName: "", contactName: "", phone: "", email: "", line: "", district: "", division: "", taxId: "", vatRegistrationNo: "", paymentTermsDays: "0", creditLimit: "", notes: "", evidence: "" };

function SupplierModal({ supplier, onClose, onDone }: { supplier: Supplier | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(() =>
    supplier
      ? {
          ...blank,
          code: supplier.code, legalName: supplier.legalName, displayName: supplier.displayName, contactName: supplier.contactName ?? "", phone: supplier.phone ?? "", email: supplier.email ?? "",
          line: supplier.address?.line ?? "", district: supplier.address?.district ?? "", division: supplier.address?.division ?? "", taxId: supplier.taxId ?? "", vatRegistrationNo: supplier.vatRegistrationNo ?? "",
          paymentTermsDays: String(supplier.paymentTermsDays), creditLimit: supplier.creditLimit === null ? "" : String(supplier.creditLimit), notes: supplier.notes ?? "", evidence: supplier.evidence ?? "",
        }
      : blank,
  );
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        legalName: f.legalName.trim(),
        displayName: f.displayName.trim() || f.legalName.trim(),
        contactName: f.contactName, phone: f.phone, email: f.email.trim() || null,
        address: { line: f.line, district: f.district, division: f.division },
        taxId: f.taxId, vatRegistrationNo: f.vatRegistrationNo,
        paymentTermsDays: Number(f.paymentTermsDays || 0),
        creditLimit: f.creditLimit.trim() === "" ? null : f.creditLimit.trim(),
        notes: f.notes, evidence: f.evidence,
      };
      if (supplier) return purchasingApi.updateSupplier(supplier.id, body);
      return purchasingApi.createSupplier(f.code.trim() ? { ...body, code: f.code.trim() } : body);
    },
    onSuccess: (s) => { toast.success(supplier ? "Supplier saved" : `Supplier ${s.code} added`); onDone(); },
    onError: (err) => toast.error(getErrorMessage(err, "The supplier couldn't be saved")),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={supplier ? `Edit ${supplier.code}` : "New supplier"}
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={f.legalName.trim().length < 2} onClick={() => save.mutate()} data-testid="save-supplier">Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        {!supplier && <Alert variant="info" title="The code is permanent">Leave it empty for the next number (SUP-0001…). It can&apos;t be changed later — it identifies the supplier across your brands.</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="sp-code" label="Code">
            <Input id="sp-code" value={f.code} onChange={set("code")} disabled={Boolean(supplier)} placeholder="Automatic" maxLength={24} />
          </Field>
          <Field htmlFor="sp-legal" label="Legal name" required>
            <Input id="sp-legal" value={f.legalName} onChange={set("legalName")} maxLength={200} />
          </Field>
          <Field htmlFor="sp-display" label="Display name">
            <Input id="sp-display" value={f.displayName} onChange={set("displayName")} maxLength={120} />
          </Field>
          <Field htmlFor="sp-contact" label="Contact person">
            <Input id="sp-contact" value={f.contactName} onChange={set("contactName")} maxLength={120} />
          </Field>
          <Field htmlFor="sp-phone" label="Phone">
            <Input id="sp-phone" value={f.phone} onChange={set("phone")} maxLength={40} />
          </Field>
          <Field htmlFor="sp-email" label="Email">
            <Input id="sp-email" type="email" value={f.email} onChange={set("email")} maxLength={200} />
          </Field>
          <Field htmlFor="sp-line" label="Address">
            <Input id="sp-line" value={f.line} onChange={set("line")} maxLength={200} />
          </Field>
          <Field htmlFor="sp-district" label="District">
            <Input id="sp-district" value={f.district} onChange={set("district")} maxLength={100} />
          </Field>
          <Field htmlFor="sp-tax" label="Tax ID / TIN">
            <Input id="sp-tax" value={f.taxId} onChange={set("taxId")} maxLength={60} />
          </Field>
          <Field htmlFor="sp-vat" label="VAT / BIN registration">
            <Input id="sp-vat" value={f.vatRegistrationNo} onChange={set("vatRegistrationNo")} maxLength={60} />
          </Field>
          <Field htmlFor="sp-terms" label="Payment terms (days)">
            <Input id="sp-terms" inputMode="numeric" value={f.paymentTermsDays} onChange={set("paymentTermsDays")} />
          </Field>
          <Field htmlFor="sp-limit" label="Credit limit" hint="A warning threshold, never a block.">
            <Input id="sp-limit" inputMode="decimal" value={f.creditLimit} onChange={set("creditLimit")} />
          </Field>
        </div>
        <Field htmlFor="sp-evidence" label="Evidence / references" hint="Trade licence, agreement — where the documents are kept.">
          <Input id="sp-evidence" value={f.evidence} onChange={set("evidence")} maxLength={1000} />
        </Field>
        <Field htmlFor="sp-notes" label="Notes">
          <Textarea id="sp-notes" rows={2} value={f.notes} onChange={set("notes")} maxLength={2000} />
        </Field>
      </div>
    </Modal>
  );
}
