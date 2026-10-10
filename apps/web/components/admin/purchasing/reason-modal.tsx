"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";

/** Asks for the reason a document action needs (cancel, close, reverse) — the reason is audited with the change. */
export function ReasonModal({ title, hint, loading, onClose, onConfirm }: { title: string; hint?: string; loading: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title={title} description={hint} widthClassName="max-w-md" footer={<><Button variant="outline" onClick={onClose}>Back</Button><Button loading={loading} disabled={reason.trim().length < 3} onClick={() => onConfirm(reason.trim())} data-testid="confirm-reason">Confirm</Button></>}>
      <Field htmlFor="reason" label="Reason" required><Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
    </Modal>
  );
}
