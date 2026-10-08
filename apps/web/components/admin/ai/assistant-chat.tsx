"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp, Bot, CheckCircle2, Clock, ExternalLink, ShieldCheck, XCircle } from "lucide-react";
import type { AiChatResponse, AiProposalView, AiResultCard } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Table, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useCapability } from "@/hooks/use-capability";
import { describeApiError } from "@/lib/api-client";
import * as aiApi from "@/lib/api/ai";
import { cn } from "@/lib/utils";

/** One chat bubble. `from` (not `role`) so it never reads like the admin's role. */
type Turn = { from: "admin"; content: string } | { from: "assistant"; content: string; cards: AiResultCard[]; proposals: AiProposalView[] };

const SUGGESTIONS = ["How were sales in the last 30 days?", "Which orders need action?", "What's out of stock or running low?"];

function ResultCard({ card }: { card: AiResultCard }) {
  const columns = card.rows[0] ? Object.keys(card.rows[0]) : [];
  return (
    <div className="overflow-hidden rounded-xl border border-line-subtle bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-3 py-2">
        <p className="text-[13px] font-medium text-fg">{card.title}</p>
        {card.href && (
          <Link href={card.href} className="flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
            Open <ExternalLink size={12} aria-hidden="true" />
          </Link>
        )}
      </div>
      {card.rows.length > 0 && (
        <div className="max-h-64 overflow-auto text-[12px]">
          <Table>
            <TableHead>
              <tr>
                {columns.map((c) => (
                  <TableHeaderCell key={c} className="capitalize">
                    {c.replace(/([A-Z])/g, " $1").toLowerCase()}
                  </TableHeaderCell>
                ))}
              </tr>
            </TableHead>
            <tbody>
              {card.rows.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((c) => (
                    <TableCell key={c} className="tabular-nums">
                      {row[c] ?? "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ProposalCard({ proposal, onChange }: { proposal: AiProposalView; onChange: (p: AiProposalView) => void }) {
  const canExecute = useCapability("ai.execute");
  const confirm = useMutation({
    mutationFn: () => aiApi.executeProposal(proposal.id),
    onSuccess: (p) => {
      onChange(p);
      toast.success(p.message ?? "Done");
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't do that")),
  });
  const cancel = useMutation({ mutationFn: () => aiApi.cancelProposal(proposal.id), onSuccess: onChange });
  const pending = proposal.status === "PENDING" && new Date(proposal.expiresAt).getTime() > Date.now();

  return (
    <div className={cn("rounded-xl border p-3.5", pending ? "border-accent/40 bg-accent/[0.04]" : "border-line-subtle bg-surface")}>
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-fg-muted">
        <ShieldCheck size={13} aria-hidden="true" /> Needs your confirmation — nothing has changed yet
      </p>
      <p className="mt-1 text-[14px] font-semibold text-fg">{proposal.title}</p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[13px] text-fg">
        {proposal.effects.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {pending ? (
          <>
            <Button size="sm" onClick={() => confirm.mutate()} disabled={!canExecute || confirm.isPending}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Cancel
            </Button>
            {!canExecute && <span className="text-[12px] text-fg-muted">Only an owner can confirm.</span>}
          </>
        ) : proposal.status === "EXECUTED" ? (
          <span className="flex items-center gap-1 text-[13px] text-success-700">
            <CheckCircle2 size={14} aria-hidden="true" /> Done
          </span>
        ) : proposal.status === "CANCELLED" ? (
          <span className="flex items-center gap-1 text-[13px] text-fg-muted">
            <XCircle size={14} aria-hidden="true" /> Cancelled
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[13px] text-fg-muted">
            <Clock size={14} aria-hidden="true" /> {proposal.status === "FAILED" ? "Couldn't be done" : "Expired — ask again"}
          </span>
        )}
        {proposal.href && (
          <Link href={proposal.href} className="ml-auto text-[12px] font-medium text-accent hover:underline">
            Open
          </Link>
        )}
      </div>
    </div>
  );
}

/** Ask the assistant (Blueprint V2 §T): answers from the store's own data; any change comes back as a proposal to
 * confirm (DR-23). The conversation lives in this page only. */
export function AssistantChat({ configured }: { configured: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const ask = useMutation({
    mutationFn: (history: Turn[]) => aiApi.chat(history.slice(-20).map((t) => ({ role: t.from === "admin" ? ("user" as const) : ("assistant" as const), content: t.content }))),
    onSuccess: (res: AiChatResponse) => setTurns((cur) => [...cur, { from: "assistant", content: res.reply, cards: res.cards, proposals: res.proposals }]),
    onError: (err) => toast.error(describeApiError(err, "The assistant couldn't answer")),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns, ask.isPending]);

  function send(text: string) {
    const content = text.trim();
    if (!content || ask.isPending) return;
    const next: Turn[] = [...turns, { from: "admin", content }];
    setTurns(next);
    setDraft("");
    ask.mutate(next);
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  }
  const updateProposal = (p: AiProposalView) =>
    setTurns((cur) => cur.map((t) => (t.from === "assistant" ? { ...t, proposals: t.proposals.map((x) => (x.id === p.id ? p : x)) } : t)));

  return (
    <section aria-label="Ask the assistant" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
      <div className="flex items-center gap-2 border-b border-line-subtle px-5 py-3">
        <Bot size={18} className="text-accent" aria-hidden="true" />
        <h2 className="text-[15px] font-semibold text-fg">Ask the assistant</h2>
        <span className="ml-auto text-[12px] text-fg-muted">Reads your store&apos;s data · changes need your confirmation</span>
      </div>
      <div className="max-h-[520px] min-h-[160px] space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-[13px] text-fg-muted">{configured ? "Ask about sales, orders or stock. Try:" : "The assistant needs an Anthropic API key on the server (ANTHROPIC_API_KEY)."}</p>
            {configured && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-fg transition-colors hover:border-line-strong">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {turns.map((t, i) =>
          t.from === "admin" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[14px] text-accent-fg">{t.content}</p>
            </div>
          ) : (
            <div key={i} className="max-w-[92%] space-y-2">
              <p className="whitespace-pre-wrap rounded-2xl rounded-bl-md bg-ink-900/[0.04] px-3.5 py-2 text-[14px] text-fg">{t.content}</p>
              {t.cards.map((c, j) => (
                <ResultCard key={j} card={c} />
              ))}
              {t.proposals.map((p) => (
                <ProposalCard key={p.id} proposal={p} onChange={updateProposal} />
              ))}
            </div>
          ),
        )}
        {ask.isPending && <p className="text-[13px] text-fg-muted">Looking…</p>}
        <div ref={endRef} />
      </div>
      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line-subtle px-4 py-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={4000}
          disabled={!configured}
          placeholder={configured ? "Ask anything about the store…" : "Not configured"}
          aria-label="Message the assistant"
          className="min-h-[40px] resize-none"
        />
        <Button type="submit" aria-label="Send" disabled={!configured || !draft.trim() || ask.isPending} className="h-10 w-10 shrink-0 rounded-full p-0">
          <ArrowUp size={18} aria-hidden="true" />
        </Button>
      </form>
    </section>
  );
}
