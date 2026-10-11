"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export interface BulkResultRow {
  orderId: string;
  orderNumber: string;
  detail?: string;
}

/** The outcome of any bulk order action, in one shape: what went through and what was refused (with the server's reason). */
export interface BulkResult {
  title: string;
  succeededLabel: string;
  succeeded: BulkResultRow[];
  failed: BulkResultRow[];
}

/** One results dialog for every bulk action (status, trash, restore, delete, courier booking/sync, delivery score). */
export function BulkResultDialog({ result, onClose, onOpenOrder }: { result: BulkResult | null; onClose: () => void; onOpenOrder: (id: string) => void }) {
  if (!result) return null;
  const groups = [
    { key: "ok", label: result.succeededLabel, rows: result.succeeded, Icon: CheckCircle2, tone: "text-success-600" },
    { key: "failed", label: "Failed", rows: result.failed, Icon: XCircle, tone: "text-danger-600" },
  ].filter((g) => g.rows.length > 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={result.title}
      description={`${result.succeeded.length} ${result.succeededLabel.toLowerCase()}, ${result.failed.length} failed.`}
      widthClassName="max-w-lg"
      footer={
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {groups.map(({ key, label, rows, Icon, tone }) => (
          <section key={key} aria-label={label}>
            <h3 className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${tone}`}>
              <Icon size={13} aria-hidden="true" /> {label} ({rows.length})
            </h3>
            <ul className="max-h-48 divide-y divide-line-subtle overflow-y-auto rounded-lg border border-line-subtle text-sm">
              {rows.map((row) => (
                <li key={row.orderId} className="flex items-start justify-between gap-3 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenOrder(row.orderId);
                    }}
                    className="shrink-0 font-medium text-info-700 hover:underline"
                  >
                    {row.orderNumber}
                  </button>
                  {row.detail && <span className="text-right text-ink-500">{row.detail}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
