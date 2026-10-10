"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { FinancialAccount, FinancialAccountKind } from "@/lib/api/finance";

const KINDS: FinancialAccountKind[] = ["CASH", "BANK", "MOBILE_WALLET", "PAYMENT_GATEWAY", "OTHER"];

/** New money account, or the editable details of an existing one (docs/FINANCE_PHASE_2.md §2). Type and opening balance
 * are fixed once the account exists. Never asks for — and the API refuses — passwords, PINs or keys. */
export function AccountDialog({ account, onClose }: { account?: FinancialAccount; onClose: () => void }) {
  const queryClient = useQueryClient();
  const editing = Boolean(account);
  const [kind, setKind] = useState<FinancialAccountKind>(account?.kind ?? "BANK");
  const [name, setName] = useState(account?.name ?? "");
  const [provider, setProvider] = useState(account?.provider ?? "");
  const [accountTitle, setTitle] = useState(account?.accountTitle ?? "");
  const [branch, setBranch] = useState(account?.branch ?? "");
  const [accountReference, setReference] = useState(account?.accountReference ?? "");
  const [threshold, setThreshold] = useState(account?.approvalThreshold != null ? String(account.approvalThreshold) : "");
  const [isActive, setActive] = useState(account?.isActive ?? true);
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));

  const update = useMutation({
    mutationFn: () =>
      financeApi.updateFinancialAccount(account!.id, {
        name: name.trim(),
        provider: provider.trim() || null,
        accountTitle: accountTitle.trim() || null,
        branch: branch.trim() || null,
        accountReference: accountReference.trim() || null,
        approvalThreshold: threshold ? Number(threshold) : null,
        ...(isActive !== account!.isActive ? { isActive } : {}),
      }),
    onSuccess: (a) => {
      void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });
      toast.success(`${a.name} updated`);
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, "The account couldn't be updated")),
  });

  const create = useMutation({
    mutationFn: () =>
      financeApi.createFinancialAccount({
        kind,
        name: name.trim(),
        provider: provider.trim() || null,
        accountTitle: accountTitle.trim() || null,
        branch: branch.trim() || null,
        accountReference: accountReference.trim() || null,
        approvalThreshold: threshold ? Number(threshold) : null,
        openingBalance: Number(openingAmount) > 0 ? { amount: Number(openingAmount), date: openingDate } : null,
      }),
    onSuccess: (account) => {
      void queryClient.invalidateQueries({ queryKey: financeApi.financeKeys.all });
      toast.success(account.openingMovement?.status === "PENDING_APPROVAL" ? `${account.name} created — its opening balance waits for approval` : `${account.name} created`);
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, "The account couldn't be created")),
  });

  const isBank = kind === "BANK";
  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit ${account!.name}` : "New money account"}
      description={editing ? "Its type and opening balance are fixed; its balance always comes from the books." : "Where money is held. Its balance always comes from the books."}
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {editing ? (
            <Button disabled={!name.trim()} loading={update.isPending} onClick={() => update.mutate()} data-testid="save-account">
              Save
            </Button>
          ) : (
            <Button disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()} data-testid="create-account">
              Create account
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field htmlFor="fa-kind" label="Type" required>
          <Select id="fa-kind" value={kind} disabled={editing} onChange={(e) => setKind(e.target.value as FinancialAccountKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {financeApi.ACCOUNT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="fa-name" label="Name" required>
          <Input id="fa-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={isBank ? "City Bank current" : kind === "MOBILE_WALLET" ? "bKash merchant" : "Cash box"} />
        </Field>
        {kind !== "CASH" && (
          <Field htmlFor="fa-provider" label={isBank ? "Bank" : "Provider"}>
            <Input id="fa-provider" value={provider} onChange={(e) => setProvider(e.target.value)} maxLength={80} />
          </Field>
        )}
        {kind !== "CASH" && (
          <Field htmlFor="fa-reference" label="Account reference" hint="Masked number or merchant id — never a password">
            <Input id="fa-reference" value={accountReference} onChange={(e) => setReference(e.target.value)} maxLength={64} />
          </Field>
        )}
        {isBank && (
          <>
            <Field htmlFor="fa-title" label="Account title">
              <Input id="fa-title" value={accountTitle} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </Field>
            <Field htmlFor="fa-branch" label="Branch">
              <Input id="fa-branch" value={branch} onChange={(e) => setBranch(e.target.value)} maxLength={120} />
            </Field>
          </>
        )}
        <Field htmlFor="fa-threshold" label="Approval above" hint="Movements of this amount or more need a second person">
          <Input id="fa-threshold" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="No approval step" />
        </Field>
        {editing ? (
          <Field htmlFor="fa-active" label="Status" hint="An account with a balance or pending movements can't be deactivated">
            <Select id="fa-active" value={isActive ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </Select>
          </Field>
        ) : (
          <>
            <div />
            <Field htmlFor="fa-opening" label="Opening balance" hint="Only for an account opened after the books started">
              <Input id="fa-opening" inputMode="decimal" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} placeholder="0.00" />
            </Field>
            <Field htmlFor="fa-opening-date" label="Opening balance date">
              <Input id="fa-opening-date" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} disabled={!(Number(openingAmount) > 0)} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
