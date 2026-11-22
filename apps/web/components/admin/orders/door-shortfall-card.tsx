"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { DoorDecision } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { decideDoorShortfall } from "@/lib/api/admin-orders";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The courier collected less than the order says (docs/PAYMENT_LEDGER.md §5d): one person says once what it was. Used on the
 * "Collected less" page and on the order itself.
 */
export function DoorShortfallCard({
  orderId,
  expected,
  collected,
  paidOut,
  canDecide,
  onDone,
  onSkip,
}: {
  orderId: string;
  expected: number;
  collected: number;
  paidOut: number | null;
  canDecide: boolean;
  onDone: () => void | Promise<void>;
  onSkip?: () => void;
}) {
  const [choice, setChoice] = useState<DoorDecision | null>(null);
  const [note, setNote] = useState("");
  const short = expected - collected;
  const decide = useMutation({
    mutationFn: () => decideDoorShortfall(orderId, { decision: choice!, note: note.trim() }),
    onSuccess: async () => {
      toast.success("Recorded");
      await onDone();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't record it. Try again."),
  });

  const options: Array<{ id: DoorDecision; title: string; meaning: string; blocked?: string }> = [
    {
      id: "AGREED_PRICE",
      title: "Price agreed at the door",
      meaning: `The order total becomes ${formatPrice(collected)} and is paid.`,
      blocked: collected <= 0 ? "Nothing was collected, so this isn't a lower price." : undefined,
    },
    { id: "STILL_OWED", title: "Customer still owes it", meaning: `The total stays. ${formatPrice(short)} is due.` },
    { id: "COLLECTED_IN_FULL", title: "It was collected in full", meaning: `Steadfast's figure is wrong. ${formatPrice(expected)} came in.` },
  ];

  return (
    <div data-testid="door-shortfall">
      <dl className="grid grid-cols-3 gap-3 rounded-xl bg-ink-900/[0.03] p-3 text-sm">
        <div>
          <dt className="text-fg-muted">To collect</dt>
          <dd className="font-medium tabular-nums text-fg">{formatPrice(expected)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Collected</dt>
          <dd className="font-medium tabular-nums text-fg" data-testid="door-collected">
            {formatPrice(collected)}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Short</dt>
          <dd className="font-semibold tabular-nums text-fg">{formatPrice(short)}</dd>
        </div>
      </dl>
      {paidOut !== null && (
        <p className="mt-2 text-sm text-fg-muted">
          Steadfast&apos;s payout paid <span className="font-medium tabular-nums text-fg">{formatPrice(paidOut)}</span> for this parcel.
        </p>
      )}
      {!canDecide ? (
        <Alert variant="info" className="mt-3" title="You can't decide this one">
          It needs permission to change prices and record payments.
        </Alert>
      ) : (
        <>
          <fieldset className="mt-4 space-y-2">
            <legend className="mb-2 text-sm font-medium text-fg">Why was it less?</legend>
            {options.map((o) => (
              <label
                key={o.id}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line-subtle p-3 text-sm focus-within:ring-2 focus-within:ring-focus",
                  choice === o.id && "border-fg bg-ink-900/[0.03]",
                  o.blocked && "cursor-not-allowed opacity-60",
                )}
              >
                <input type="radio" name={`door-${orderId}`} className="mt-0.5 size-4 shrink-0" checked={choice === o.id} disabled={Boolean(o.blocked)} onChange={() => setChoice(o.id)} />
                <span className="min-w-0">
                  <span className="block font-medium text-fg">{o.title}</span>
                  <span className="block text-fg-muted">{o.blocked ?? o.meaning}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field htmlFor={`door-note-${orderId}`} label="Note" className="mt-3" hint="Kept on the order's timeline.">
            <Input id={`door-note-${orderId}`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Customer bargained at the door" />
          </Field>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {onSkip && (
              <Button variant="ghost" onClick={onSkip} disabled={decide.isPending} data-testid="door-skip">
                Skip for now
              </Button>
            )}
            <Button onClick={() => decide.mutate()} loading={decide.isPending} disabled={!choice || note.trim().length < 3} data-testid="door-record">
              Record
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
