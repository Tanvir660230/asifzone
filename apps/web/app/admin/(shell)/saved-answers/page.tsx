"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, Pause, Plus, Sparkles, Trash2 } from "lucide-react";
import { SAVED_ANSWER_PLACEHOLDERS, type SavedAnswerView } from "@clothing-brand/shared";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useCapability } from "@/hooks/use-capability";
import { describeApiError } from "@/lib/api-client";
import * as answersApi from "@/lib/api/saved-answers";
import { formatCount, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const KEY = ["saved-answers"];

/** Live-value chips: clicking one adds {key} to the answer, so a fee or link is always today's. */
function PlaceholderChips({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12px] text-fg-subtle">Insert live value:</span>
      {SAVED_ANSWER_PLACEHOLDERS.map((p) => (
        <button
          key={p.key}
          type="button"
          title={`e.g. ${p.example}`}
          onClick={() => onInsert(`{${p.key}}`)}
          className="rounded-full border border-line px-2 py-0.5 text-[12px] text-fg-muted transition-colors duration-fast hover:border-accent hover:text-accent"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** A number written into an answer goes stale when the fee or price changes — a live value doesn't. */
function staleHint(answer: string): string | null {
  return /\d/.test(answer.replace(/\{\w+\}/g, "")) ? "Has numbers — if they can change, use a live value instead." : null;
}

function AnswerCard({ item, canEdit }: { item: SavedAnswerView; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  const [answer, setAnswer] = useState(item.answer);
  const [autoSend, setAutoSend] = useState(item.autoSend);
  const suggested = item.status === "SUGGESTED";
  const changed = answer.trim() !== item.answer;
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });

  const save = useMutation({
    mutationFn: (input: Parameters<typeof answersApi.updateSavedAnswer>[1]) => answersApi.updateSavedAnswer(item.id, input),
    onSuccess: (_d, input) => {
      refresh();
      toast.success(input.status === "APPROVED" ? "Approved — it answers this question from now on" : input.status === "DISMISSED" ? "Dismissed" : "Saved");
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't save the answer")),
  });
  const remove = useMutation({
    mutationFn: () => answersApi.deleteSavedAnswer(item.id),
    onSuccess: () => {
      refresh();
      toast.success("Answer deleted");
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't delete the answer")),
  });

  const hint = staleHint(answer);
  const others = item.examples.filter((e) => e !== item.title);
  return (
    <li className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-xs sm:p-5">
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-fg">&ldquo;{item.title}&rdquo;</p>
          {others.length > 0 && (
            <p className="mt-0.5 text-[12px] text-fg-subtle">
              Also asked as {others.slice(0, 3).map((e) => `“${e}”`).join(", ")}
              {item.exampleCount > others.length + 1 ? ` · ${formatCount(item.exampleCount)} times in all` : ""}
            </p>
          )}
        </div>
        {!suggested && (
          <p className="shrink-0 text-[12px] tabular-nums text-fg-subtle">
            Used {formatCount(item.hits)}×{item.corrections ? ` · rewritten ${formatCount(item.corrections)}×` : ""}
            {item.lastHitAt ? ` · last ${timeAgo(item.lastHitAt)}` : ""}
          </p>
        )}
      </div>

      {item.autoPausedAt && (
        <p className="flex items-start gap-1.5 rounded-lg bg-warning-50 px-3 py-2 text-[13px] text-warning-800">
          <Pause size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          Auto-send paused by itself — staff kept rewriting this answer. Check the wording, then turn it back on.
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor={`answer-${item.id}`} className="text-[12px] font-medium text-fg-muted">
          Answer
        </label>
        <Textarea id={`answer-${item.id}`} rows={3} value={answer} disabled={!canEdit} onChange={(e) => setAnswer(e.target.value)} />
        {canEdit && <PlaceholderChips onInsert={(t) => setAnswer((a) => `${a.trimEnd()} ${t}`.trim())} />}
        {hint && <p className="text-[12px] text-warning-700">{hint}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-3">
        <label className="flex items-center gap-2 text-[13px] text-fg">
          <Switch
            checked={autoSend}
            disabled={!canEdit}
            aria-label="Send automatically"
            onChange={(next) => {
              setAutoSend(next);
              if (!suggested) save.mutate({ autoSend: next });
            }}
          />
          <span>
            Send automatically
            <span className="block text-[12px] text-fg-subtle">Off: it waits as a draft for staff.</span>
          </span>
        </label>
        {canEdit && (
          <div className="flex items-center gap-2">
            {suggested ? (
              <>
                <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ status: "DISMISSED" })}>
                  Dismiss
                </Button>
                <Button type="button" size="sm" loading={save.isPending} onClick={() => save.mutate({ status: "APPROVED", answer: answer.trim(), autoSend })}>
                  Approve
                </Button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="Delete answer"
                  className="rounded-full p-2 text-fg-subtle transition-colors hover:bg-danger-50 hover:text-danger-600"
                  onClick={async () => {
                    if (await confirm(`Delete the answer to “${item.title}”? The Inbox stops using it.`)) remove.mutate();
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
                <Button type="button" size="sm" disabled={!changed || !answer.trim()} loading={save.isPending} onClick={() => save.mutate({ answer: answer.trim() })}>
                  Save
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function NewAnswer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [examples, setExamples] = useState("");
  const [answer, setAnswer] = useState("");
  const [autoSend, setAutoSend] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      answersApi.createSavedAnswer({
        title: title.trim(),
        answer: answer.trim(),
        examples: examples.split("\n").map((e) => e.trim()).filter(Boolean),
        autoSend,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      toast.success("Answer saved");
      onClose();
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't save the answer")),
  });
  const hint = staleHint(answer);
  return (
    <form
      className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-xs sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() && answer.trim()) create.mutate();
      }}
    >
      <p className="text-[15px] font-semibold text-fg">New answer</p>
      <div className="space-y-1.5">
        <label htmlFor="new-title" className="text-[12px] font-medium text-fg-muted">
          The question
        </label>
        <Input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Apnader shop kothay?" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="new-examples" className="text-[12px] font-medium text-fg-muted">
          Other ways customers ask it <span className="font-normal text-fg-subtle">(one per line, optional)</span>
        </label>
        <Textarea id="new-examples" rows={2} value={examples} onChange={(e) => setExamples(e.target.value)} placeholder={"dokan kothay\nshowroom ache?"} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="new-answer" className="text-[12px] font-medium text-fg-muted">
          Answer
        </label>
        <Textarea id="new-answer" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="e.g. Amader online shop: {website}" />
        <PlaceholderChips onInsert={(t) => setAnswer((a) => `${a.trimEnd()} ${t}`.trim())} />
        {hint && <p className="text-[12px] text-warning-700">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-3">
        <label className="flex items-center gap-2 text-[13px] text-fg">
          <Switch checked={autoSend} onChange={setAutoSend} aria-label="Send automatically" />
          Send automatically
        </label>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!title.trim() || !answer.trim()} loading={create.isPending}>
            Save answer
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Messages › Saved answers (owner 2026-10-18): what the Inbox learned from the team's replies. Approved answers reply to
 * the same question — however it's typed — instantly and without the AI; corrections pause them by themselves. */
export default function SavedAnswersPage() {
  const canEdit = useCapability("customers.message");
  const [creating, setCreating] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: KEY, queryFn: answersApi.listSavedAnswers });
  const empty = data && data.suggested.length === 0 && data.approved.length === 0;

  return (
    <div>
      <PageHeader
        title="Saved answers"
        description="Answers the Inbox learned from your team's replies. Approved ones answer the same question instantly — without the AI."
        action={
          canEdit && !creating ? (
            <Button type="button" size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} aria-hidden="true" /> New answer
            </Button>
          ) : undefined
        }
      />
      <ModuleTabs />
      <div className="max-w-3xl space-y-6">
        {data && (
          <p className="flex items-center gap-2 text-[13px] text-fg-muted">
            <BookOpenCheck size={15} className="text-accent" aria-hidden="true" />
            <span>
              <span className="font-semibold tabular-nums text-fg">{formatCount(data.answeredWithoutAi)}</span> questions answered without the AI in the last 30 days
            </span>
          </p>
        )}
        {creating && <NewAnswer onClose={() => setCreating(false)} />}
        {isLoading && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading saved answers">
            {[0, 1].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-ink-900/[0.04]" />
            ))}
          </div>
        )}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {empty && !creating && (
          <EmptyState
            icon={Sparkles}
            variant="bordered"
            title="Nothing learned yet"
            description="As your team answers chats, questions that keep getting the same answer show up here to approve. You can also write one now."
          />
        )}
        {data && data.suggested.length > 0 && (
          <section aria-labelledby="suggested-heading" className="space-y-3">
            <div>
              <h2 id="suggested-heading" className="flex items-center gap-1.5 text-[15px] font-semibold text-fg">
                <Sparkles size={15} className="text-accent" aria-hidden="true" /> Learned — waiting for you
              </h2>
              <p className="text-[13px] text-fg-muted">Your team gave these answers again and again. Check the wording, then approve.</p>
            </div>
            <ul className="space-y-3">
              {data.suggested.map((item) => (
                <AnswerCard key={`${item.id}:${item.answer}`} item={item} canEdit={canEdit} />
              ))}
            </ul>
          </section>
        )}
        {data && data.approved.length > 0 && (
          <section aria-labelledby="approved-heading" className={cn("space-y-3", data.suggested.length > 0 && "pt-2")}>
            <h2 id="approved-heading" className="text-[15px] font-semibold text-fg">
              In use · {formatCount(data.approved.length)}
            </h2>
            <ul className="space-y-3">
              {data.approved.map((item) => (
                <AnswerCard key={`${item.id}:${item.answer}:${item.autoSend}`} item={item} canEdit={canEdit} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
