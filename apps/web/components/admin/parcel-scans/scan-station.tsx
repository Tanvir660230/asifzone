"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, CircleSlash, CloudOff, Loader2, ScanLine, X, XCircle } from "lucide-react";
import { PARCEL_SCAN_RESULT_LABELS, type ParcelScanBatchView, type ParcelScanEventRow, type ParcelScanKind, type ParcelScanResult } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import * as scansApi from "@/lib/api/parcel-scans";
import { getOrderStats } from "@/lib/api/admin-orders";
import { formatCount, formatStoreTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { invalidateOrderQueries, orderKeys } from "@/components/admin/orders/order-domain";
import { CameraScanner } from "./camera-scanner";

/**
 * A scanning station (Order Operations plan, phase 4): a USB keyboard-wedge scanner types the code and presses Enter into
 * an input that always keeps focus; a phone can use its camera instead. Every scan is answered at once — colour, words,
 * a sound and a screen-reader announcement. Scans are queued on the device with their own id, so twenty fast scans are
 * never lost, and a scan made offline waits (clearly marked) until the server has judged it; confirming stays off until
 * every scan has an answer. Confirming writes the handover / receipt — never stock, money or the order's status.
 */

type Pending = { clientScanId: string; code: string; at: string; state: "sending" | "waiting" | "failed"; error?: string };

const COPY: Record<ParcelScanKind, { title: string; confirm: (n: number) => string; done: string; empty: string; queues: { id: string; label: string }[] }> = {
  DISPATCH: {
    title: "Dispatch",
    confirm: (n) => `Confirm handover of ${n} parcel${n === 1 ? "" : "s"}`,
    done: "Handed to the courier",
    empty: "Scan each parcel as the rider takes it. Only booked, confirmed orders are added.",
    queues: [
      { id: "handoverPending", label: "Handover pending" },
      { id: "stuckInTransit", label: "Stuck in transit" },
    ],
  },
  RETURN: {
    title: "Returns in",
    confirm: (n) => `Confirm ${n} parcel${n === 1 ? "" : "s"} received`,
    done: "Received back — inspect them to restock",
    empty: "Scan each parcel as it comes back. Stock is unchanged until the parcel is inspected on its order.",
    queues: [
      { id: "comingBack", label: "Coming back" },
      { id: "inspectionPending", label: "To inspect" },
      { id: "scanDiscrepancy", label: "Discrepancy" },
      { id: "returnOverdue", label: "Return overdue" },
    ],
  },
};

const RESULT_TONE: Record<ParcelScanResult, "ok" | "warn" | "error"> = { ACCEPTED: "ok", DUPLICATE: "warn", ALREADY_PROCESSED: "warn", INVALID: "error", INELIGIBLE: "error" };

/** A short tone per outcome (and a buzz on phones): one high beep = added, two mid = already done, one low = refused. */
function useFeedbackSound() {
  const ctx = useRef<AudioContext | null>(null);
  return useCallback((tone: "ok" | "warn" | "error") => {
    try {
      ctx.current ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const ac = ctx.current;
      const beeps = tone === "ok" ? [[1046, 0.09]] : tone === "warn" ? [[660, 0.08], [660, 0.08]] : [[220, 0.28]];
      let t = ac.currentTime;
      for (const [freq, dur] of beeps) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.frequency.value = freq!;
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur!);
        osc.connect(gain).connect(ac.destination);
        osc.start(t);
        osc.stop(t + dur!);
        t += dur! + 0.06;
      }
    } catch {
      // No audio (autoplay policy before the first interaction): colour and text still say it.
    }
    navigator.vibrate?.(tone === "ok" ? 40 : tone === "warn" ? [40, 60, 40] : 220);
  }, []);
}

function newScanId() {
  return (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
}

export function ScanStation({ kind }: { kind: ParcelScanKind }) {
  const copy = COPY[kind];
  const queryClient = useQueryClient();
  const play = useFeedbackSound();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [batch, setBatch] = useState<ParcelScanBatchView | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [pending, setPending] = useState<Pending[]>([]);
  // The scan queue's source of truth (the sender reads it between awaits); `pending` mirrors it for rendering.
  const queueRef = useRef<Pending[]>([]);
  const setQueue = useCallback((fn: (cur: Pending[]) => Pending[]) => {
    queueRef.current = fn(queueRef.current);
    setPending(queueRef.current);
  }, []);
  const [last, setLast] = useState<{ tone: "ok" | "warn" | "error" | "waiting"; text: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [finished, setFinished] = useState<ParcelScanBatchView | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const storageKey = `parcel-scan-queue:${kind}`;

  const { data: stats } = useQuery({ queryKey: orderKeys.stats, queryFn: getOrderStats, refetchInterval: 60_000 });
  const { data: summary } = useQuery({ queryKey: ["parcel-scan-summary"], queryFn: scansApi.dispatchSummary, enabled: kind === "DISPATCH", refetchInterval: 60_000 });
  const { data: automation } = useQuery({ queryKey: ["courier-automation"], queryFn: scansApi.latestAutomation, staleTime: 5 * 60_000 });

  // Resume this operator's open batch; restore scans still queued on this device (made offline before a refresh).
  const loadBatch = useCallback(async () => {
    setLoadState("loading");
    try {
      const { batch } = await scansApi.currentBatch(kind);
      setBatch(batch);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [kind]);
  useEffect(() => {
    void loadBatch();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Pending[];
      if (Array.isArray(saved) && saved.length) setQueue(() => saved.map((p) => ({ ...p, state: "waiting" as const })));
    } catch {
      // Nothing saved.
    }
  }, [loadBatch, storageKey, setQueue]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(pending.filter((p) => p.state !== "failed")));
    } catch {
      // Storage full / blocked: the queue still lives for this page.
    }
  }, [pending, storageKey]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // The wedge scanner types into whatever has focus: keep it on the scan box unless the operator is using another control.
  useEffect(() => {
    const refocus = () => {
      const active = document.activeElement as HTMLElement | null;
      const elsewhere = active && active !== document.body && active !== inputRef.current && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.closest("[role=dialog]"));
      if (!elsewhere && !cameraOpen) inputRef.current?.focus({ preventScroll: true });
    };
    const t = window.setInterval(refocus, 800);
    refocus();
    return () => window.clearInterval(t);
  }, [cameraOpen]);

  // A wedge scanner that fires while focus is elsewhere (a button, the page) must neither lose characters nor trigger the
  // admin's keyboard shortcuts ("N" = new order, "G …" = go to): keystrokes not aimed at another field are taken here, in
  // the capture phase, and typed into the scan box.
  const codeRef = useRef("");
  codeRef.current = code;
  const submitRef = useRef<(raw: string) => void>(() => {});
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (cameraOpen || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t === inputRef.current) return;
      const editable = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (editable || t?.closest("[role=dialog]")) return;
      if (e.key === "Enter" && codeRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        submitRef.current(codeRef.current);
      } else if (e.key.length === 1) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setCode((c) => c + e.key);
        inputRef.current?.focus({ preventScroll: true });
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [cameraOpen]);

  const batchRef = useRef<ParcelScanBatchView | null>(null);
  batchRef.current = batch;
  const ensureBatch = useCallback(async () => {
    if (batchRef.current && batchRef.current.status === "OPEN") return batchRef.current;
    const created = await scansApi.createBatch(kind);
    batchRef.current = created;
    setBatch(created);
    return created;
  }, [kind]);

  // One sender at a time, in scan order: the server's answers come back in the order the parcels were scanned.
  const sending = useRef(false);
  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      for (;;) {
        const next = queueRef.current.find((p) => p.state !== "failed");
        if (!next) break;
        setQueue((cur) => cur.map((p) => (p.clientScanId === next.clientScanId ? { ...p, state: "sending" } : p)));
        try {
          const b = await ensureBatch();
          const event = await scansApi.recordScan(b.id, next.code, next.clientScanId);
          setQueue((cur) => cur.filter((p) => p.clientScanId !== next.clientScanId));
          setBatch((cur) => (cur ? { ...cur, events: [event, ...cur.events.filter((e) => e.clientScanId !== event.clientScanId)], accepted: cur.accepted + (event.result === "ACCEPTED" ? 1 : 0) } : cur));
          const tone = RESULT_TONE[event.result];
          play(tone);
          // The message already names the order or the problem; "Added" is said once, for an accepted scan.
          setLast({ tone, text: event.result === "ACCEPTED" ? `Added — ${event.message}` : event.message });
        } catch (err) {
          const transient = !(err instanceof ApiError) || err.status === 0 || err.status >= 500 || err.status === 429;
          if (transient) {
            // Kept on the device, marked, and retried — never shown as done before the server says so.
            setQueue((cur) => cur.map((p) => (p.clientScanId === next.clientScanId ? { ...p, state: "waiting" } : p)));
            setLast({ tone: "waiting", text: `Saved on this device — waiting for the connection (${next.code})` });
            break;
          }
          if (err.status === 409) {
            // The batch was closed elsewhere: start a fresh one and retry this scan there.
            batchRef.current = null;
            setBatch(null);
            setQueue((cur) => cur.map((p) => (p.clientScanId === next.clientScanId ? { ...p, state: "waiting" } : p)));
            continue;
          }
          setQueue((cur) => cur.map((p) => (p.clientScanId === next.clientScanId ? { ...p, state: "failed", error: getErrorMessage(err, "Refused") } : p)));
          play("error");
          setLast({ tone: "error", text: `${next.code}: ${getErrorMessage(err, "Refused")}` });
        }
      }
    } finally {
      sending.current = false;
    }
  }, [ensureBatch, play, setQueue]);

  // Retry what is waiting when the connection comes back, and every few seconds while anything waits.
  const waitingCount = pending.filter((p) => p.state === "waiting").length;
  useEffect(() => {
    if (!waitingCount) return;
    const t = window.setInterval(() => void flush(), 5000);
    return () => window.clearInterval(t);
  }, [waitingCount, flush]);
  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  submitRef.current = (raw: string) => submit(raw);
  function submit(raw: string) {
    const value = raw.trim();
    if (!value) return;
    setQueue((cur) => [...cur, { clientScanId: newScanId(), code: value, at: new Date().toISOString(), state: "waiting" }]);
    setCode("");
    queueMicrotask(() => void flush());
  }

  async function confirm() {
    if (!batch) return;
    setConfirming(true);
    try {
      const done = await scansApi.confirmBatch(batch.id);
      setFinished(done);
      setBatch(null);
      batchRef.current = null;
      invalidateOrderQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["parcel-scan-summary"] });
      toast.success(`${done.accepted} parcel${done.accepted === 1 ? "" : "s"} confirmed`);
      // Ready for the next parcel straight away (the scanner types into whatever has focus).
      inputRef.current?.focus();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't confirm the batch"));
      if (batch) setBatch(await scansApi.getBatch(batch.id).catch(() => batch));
    } finally {
      setConfirming(false);
    }
  }

  async function remove(event: ParcelScanEventRow) {
    if (!batch) return;
    try {
      setBatch(await scansApi.voidScan(batch.id, event.id));
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't remove the scan"));
    }
  }

  async function cancel() {
    if (!batch) return;
    try {
      await scansApi.cancelBatch(batch.id);
      setBatch(null);
      batchRef.current = null;
      setLast(null);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't cancel the batch"));
    }
  }

  const events = useMemo(() => (batch?.events ?? []).filter((e) => !e.voided), [batch]);
  const accepted = events.filter((e) => e.result === "ACCEPTED").length;
  const unanswered = pending.filter((p) => p.state !== "failed").length;
  const canConfirm = Boolean(batch) && accepted > 0 && unanswered === 0 && online && !confirming;

  if (loadState === "loading") return <div className="mt-4 h-48 rounded-xl ui-skeleton" aria-hidden="true" />;
  if (loadState === "error")
    return (
      <div className="mt-4 rounded-xl border border-line-subtle bg-surface p-6 text-sm">
        <p className="text-fg">Couldn&apos;t open the scanning station.</p>
        <Button className="mt-3" variant="outline" size="sm" onClick={() => void loadBatch()}>
          Try again
        </Button>
      </div>
    );

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {kind === "DISPATCH" && summary && (
          <span className="rounded-full bg-surface px-3 py-1.5 text-fg-muted ring-1 ring-line-subtle" data-testid="dispatch-summary">
            Today: {formatCount(summary.bookedToday)} booked · {formatCount(summary.handedOverToday)} handed over
          </span>
        )}
        {copy.queues.map((q) => (
          <Link key={q.id} href={`/admin/orders?f.queue=${q.id}`} className="rounded-full bg-surface px-3 py-1.5 text-fg ring-1 ring-line-subtle hover:ring-line-strong">
            {q.label} <span className="tabular-nums text-fg-subtle">{formatCount(stats?.queueCounts?.[q.id as keyof NonNullable<typeof stats>["queueCounts"]] ?? 0)}</span>
          </Link>
        ))}
      </div>

      {automation?.run && (
        <p className="text-xs text-fg-muted" data-testid="courier-check">
          Daily courier check {automation.run.day}: {automation.run.stuckInTransit} stuck in transit · {automation.run.returnOverdue} overdue return
          {automation.run.returnOverdue === 1 ? "" : "s"} · {automation.run.payoutsChecked} payout{automation.run.payoutsChecked === 1 ? "" : "s"} checked
          {automation.run.outcome !== "OK" && automation.run.message ? <span className="text-warning-800"> — {automation.run.message}</span> : null}
        </p>
      )}

      {finished && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-800">
          <span className="flex items-center gap-2">
            <CheckCircle2 size={16} aria-hidden="true" /> {copy.done}: {finished.accepted} parcel{finished.accepted === 1 ? "" : "s"} ({formatStoreTime(finished.confirmedAt ?? finished.createdAt)}).
          </span>
          <Button size="sm" variant="outline" onClick={() => setFinished(null)}>
            Close
          </Button>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(code);
          }}
          className="flex gap-2"
        >
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Scan or type a parcel code</span>
            <ScanLine size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
            <Input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan, or type a code and press Enter"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              inputMode="text"
              className="h-12 pl-10 text-base"
              data-testid="scan-input"
            />
          </label>
          <Button type="button" variant="outline" className="h-12 w-12 shrink-0 px-0" aria-label="Scan with the camera" onClick={() => setCameraOpen(true)}>
            <Camera size={18} />
          </Button>
        </form>

        <div
          aria-live="assertive"
          role="status"
          data-testid="scan-feedback"
          data-tone={last?.tone ?? ""}
          className={cn(
            "mt-3 flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium",
            !last && "bg-surface-muted text-fg-muted",
            last?.tone === "ok" && "bg-success-50 text-success-800",
            last?.tone === "warn" && "bg-warning-50 text-warning-800",
            last?.tone === "error" && "bg-danger-50 text-danger-700",
            last?.tone === "waiting" && "bg-info-50 text-info-800",
          )}
        >
          {last?.tone === "ok" && <CheckCircle2 size={16} aria-hidden="true" />}
          {last?.tone === "warn" && <AlertTriangle size={16} aria-hidden="true" />}
          {last?.tone === "error" && <XCircle size={16} aria-hidden="true" />}
          {last?.tone === "waiting" && <CloudOff size={16} aria-hidden="true" />}
          <span>{last?.text ?? copy.empty}</span>
        </div>

        {!online && (
          <p className="mt-2 flex items-center gap-2 text-xs text-info-800">
            <CloudOff size={13} aria-hidden="true" /> Offline — scans are kept on this device and checked when the connection is back. Confirming waits until then.
          </p>
        )}
      </div>

      <section aria-label="Scans in this batch" className="rounded-2xl border border-line-subtle bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">
            This batch <span className="font-normal text-fg-muted">· {accepted} to confirm{unanswered ? ` · ${unanswered} waiting` : ""}</span>
          </h2>
          {batch && (
            <button type="button" className="text-xs text-fg-muted underline-offset-2 hover:underline" onClick={() => void cancel()}>
              Cancel batch
            </button>
          )}
        </div>
        {pending.length === 0 && events.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fg-muted">No scans yet.</p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-line-subtle overflow-y-auto" data-testid="scan-list">
            {pending.map((p) => (
              <li key={p.clientScanId} className="flex items-center gap-3 px-4 py-2.5 text-sm" data-testid="scan-row" data-result={p.state === "failed" ? "FAILED" : "PENDING"}>
                {p.state === "sending" ? <Loader2 size={15} className="animate-spin text-fg-subtle" aria-hidden="true" /> : p.state === "failed" ? <XCircle size={15} className="text-danger-600" aria-hidden="true" /> : <CloudOff size={15} className="text-info-700" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{p.code}</span>
                <span className={cn("text-xs", p.state === "failed" ? "text-danger-700" : "text-info-800")}>{p.state === "failed" ? p.error : p.state === "sending" ? "Checking…" : "Waiting for connection"}</span>
                {p.state === "failed" && (
                  <button type="button" aria-label={`Dismiss ${p.code}`} className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:bg-ink-900/[0.05]" onClick={() => setQueue((cur) => cur.filter((x) => x.clientScanId !== p.clientScanId))}>
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
            {events.map((e) => {
              const tone = RESULT_TONE[e.result];
              return (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm" data-testid="scan-row" data-result={e.result}>
                  {tone === "ok" ? <CheckCircle2 size={15} className="shrink-0 text-success-600" aria-hidden="true" /> : tone === "warn" ? <AlertTriangle size={15} className="shrink-0 text-warning-600" aria-hidden="true" /> : <CircleSlash size={15} className="shrink-0 text-danger-600" aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg">
                      {e.orderNumber ? (
                        <Link href={`/admin/orders?open=${e.orderId}`} className="font-medium hover:underline">
                          {e.orderNumber}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">{e.code}</span>
                      )}
                      {e.customerName && <span className="text-fg-muted"> · {e.customerName}</span>}
                    </span>
                    <span className={cn("block truncate text-xs", tone === "ok" ? "text-fg-subtle" : tone === "warn" ? "text-warning-800" : "text-danger-700")}>
                      {e.result === "ACCEPTED" ? (e.discrepancy ? e.message : PARCEL_SCAN_RESULT_LABELS.ACCEPTED) : e.message}
                    </span>
                  </span>
                  {e.discrepancy && <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[11px] font-medium text-warning-800">Check</span>}
                  {e.result === "ACCEPTED" && batch?.status === "OPEN" && (
                    <button type="button" aria-label={`Remove ${e.orderNumber ?? e.code} from the batch`} className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:bg-ink-900/[0.05]" onClick={() => void remove(e)}>
                      <X size={14} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-canvas/95 px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button className="min-h-[48px] w-full sm:w-auto" disabled={!canConfirm} loading={confirming} onClick={() => void confirm()} data-testid="confirm-batch">
          {copy.confirm(accepted)}
        </Button>
        {unanswered > 0 && <p className="mt-1.5 text-xs text-fg-muted">Confirm unlocks once every scan has been checked by the server.</p>}
      </div>

      {cameraOpen && (
        <CameraScanner
          onClose={() => setCameraOpen(false)}
          onCode={(value) => {
            submit(value);
          }}
        />
      )}
    </div>
  );
}
