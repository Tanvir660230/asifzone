"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, CloudOff, Link2, Minus, PackageOpen, Plus, ScanLine, XCircle } from "lucide-react";
import {
  PARCEL_MONEY_REASONS,
  PARCEL_MONEY_REASON_LABELS,
  SCAN_MATCH_LABELS,
  type ParcelLineView,
  type ParcelMoneyReason,
  type ParcelResolveResult,
  type ParcelView,
  type ReceiveParcelInput,
} from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import * as scansApi from "@/lib/api/parcel-scans";
import { getOrderExceptions, getOrderStats } from "@/lib/api/admin-orders";
import { formatCount, formatPrice, formatStoreDate, storeCurrencySymbol } from "@/lib/format";
import { cn } from "@/lib/utils";
import { invalidateOrderQueries, orderKeys } from "@/components/admin/orders/order-domain";
import { CameraScanner } from "./camera-scanner";
import { ParcelHeader, ParcelHistory } from "./parcel-card";
import { ScannerBar } from "./scanner-bar";
import { useScannerSound, type ScannerTone } from "./scanner-sound";
import { useWedgeScanner } from "./use-wedge-scanner";

/**
 * Returns in — receive and inspect, one parcel at a time (docs/ORDER_OPERATIONS.md "Receive and inspect"). Scan any code
 * on the parcel (Steadfast's slip or QR, our label, the order number, a product, the customer's phone); the parcel opens
 * with every line. Say what came back — good, damaged, missing, wrong item, other — and, when the courier hasn't reported
 * it, whether the customer kept anything. One Confirm writes it all on the server; nothing is shown as done until the
 * server says so. A scan only opens a parcel: no return record is ever created by scanning.
 */

type Counts = { kept: number; good: number; damaged: number; missing: number; wrong: number; other: number; note: string };
const EMPTY: Counts = { kept: 0, good: 0, damaged: 0, missing: 0, wrong: 0, other: 0, note: "" };
const FINDINGS = [
  { key: "good", label: "Good", hint: "Back on the shelf" },
  { key: "damaged", label: "Damaged", hint: "Written off" },
  { key: "missing", label: "Missing", hint: "Stays waiting" },
  { key: "wrong", label: "Wrong item", hint: "Stays waiting" },
  { key: "other", label: "Other", hint: "Stays waiting" },
] as const;

type Feedback = { tone: "ok" | "warn" | "error" | "busy"; text: string } | null;
type View =
  | { kind: "idle" }
  | { kind: "loading"; code: string }
  | { kind: "candidates"; result: ParcelResolveResult }
  | { kind: "unknown"; result: ParcelResolveResult }
  | { kind: "parcel"; parcel: ParcelView; code: string | null; matchedBy: ParcelResolveResult["matchedBy"] };

const decides = (p: ParcelView) => p.receive.mode === "DECIDE_OUTCOME" || p.receive.mode === "RECONCILE";

export function ReceiveStation() {
  const queryClient = useQueryClient();
  const sound = useScannerSound();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [view, setView] = useState<View>({ kind: "idle" });
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [online, setOnline] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const [form, setForm] = useState<{ outcome: "FULL_RETURN" | "PARTIAL" | null; lines: Record<string, Counts>; money: { actual: string; charge: string; reason: ParcelMoneyReason | ""; note: string }; note: string }>({
    outcome: null,
    lines: {},
    money: { actual: "", charge: "", reason: "", note: "" },
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const [correcting, setCorrecting] = useState<string | null>(null);

  const { data: stats } = useQuery({ queryKey: orderKeys.stats, queryFn: getOrderStats, refetchInterval: 60_000 });
  const { data: exceptions } = useQuery({ queryKey: [...orderKeys.stats, "exceptions"], queryFn: ({ signal }) => getOrderExceptions({ signal }), refetchInterval: 60_000 });

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

  const say = useCallback(
    (tone: ScannerTone, text: string) => {
      sound.play(tone);
      setFeedback({ tone: tone === "scan" || tone === "success" ? "ok" : tone === "duplicate" ? "warn" : "error", text });
    },
    [sound],
  );

  const dirty = useMemo(() => {
    if (view.kind !== "parcel") return false;
    return Object.values(form.lines).some((l) => l.kept || l.good || l.damaged || l.missing || l.wrong || l.other || l.note) || Boolean(form.money.actual) || Boolean(form.note);
  }, [form, view]);

  const openParcel = useCallback(async (orderId: string, scanned: string | null, matchedBy: ParcelResolveResult["matchedBy"]) => {
    const parcel = await scansApi.getParcel(orderId);
    setForm({ outcome: null, lines: Object.fromEntries(parcel.lines.map((l) => [l.orderItemId, { ...EMPTY }])), money: { actual: "", charge: "", reason: "", note: "" }, note: "" });
    setView({ kind: "parcel", parcel, code: scanned, matchedBy });
    return parcel;
  }, []);

  // On a phone the parcel opens below the scanner and the counts: bring it into view so the operator sees what to count
  // without scrolling. The scanner input keeps focus (a wedge scanner still types into it).
  const openedId = view.kind === "parcel" ? view.parcel.orderId : null;
  useEffect(() => {
    if (!openedId || !window.matchMedia("(max-width: 767px)").matches) return;
    requestAnimationFrame(() => document.querySelector('[data-testid="parcel-card"]')?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [openedId]);

  /** A scan of one of the open parcel's own products counts one unit good — inspection by scanning each item. */
  const countItem = useCallback(
    (raw: string, parcel: ParcelView) => {
      const line = parcel.lines.find((l) => l.sku.toLowerCase() === raw.trim().toLowerCase());
      if (!line || parcel.receive.mode === "NOTHING") return false;
      const cur = form.lines[line.orderItemId] ?? EMPTY;
      const cap = capOf(line, cur, parcel);
      const used = cur.good + cur.damaged + cur.missing + cur.wrong + cur.other;
      if (used >= cap) {
        say("duplicate", `All ${cap} of ${line.name} are already counted`);
        return true;
      }
      setForm((f) => ({ ...f, lines: { ...f.lines, [line.orderItemId]: { ...cur, good: cur.good + 1 } } }));
      say("scan", `${line.name}: ${cur.good + 1} good`);
      return true;
    },
    [form.lines, say],
  );

  const handleCode = useCallback(
    async (raw: string, opts: { force?: boolean } = {}) => {
      const value = raw.trim();
      if (!value) return;
      setCode("");
      setLastCode(value);
      if (view.kind === "parcel" && countItem(value, view.parcel)) return;
      if (!dirty) setView({ kind: "loading", code: value });
      setFeedback({ tone: "busy", text: `Looking up ${value}…` });
      try {
        const result = await scansApi.resolveCode(value, "RETURN");
        if (view.kind === "parcel" && result.kind === "ORDER" && result.orderId === view.parcel.orderId) {
          say("duplicate", `${view.parcel.orderNumber} is already open`);
          return;
        }
        if (dirty && !opts.force) {
          // Another parcel scanned with unsaved entries: hold it, keep what was typed (a wrong parcel is never opened silently).
          setHeld(value);
          say("invalid", `Unsaved entries for ${view.kind === "parcel" ? view.parcel.orderNumber : "this parcel"} — save or discard them first`);
          return;
        }
        setHeld(null);
        if (result.kind === "ORDER" && result.orderId) {
          const parcel = await openParcel(result.orderId, value, result.matchedBy);
          if (parcel.receive.mode === "NOTHING") say("duplicate", `${parcel.orderNumber}: ${parcel.receive.message}`);
          else say("scan", `${parcel.orderNumber} · ${parcel.customerName}`);
        } else if (result.kind === "CANDIDATES") {
          setView({ kind: "candidates", result });
          say("duplicate", result.message);
        } else {
          setView({ kind: "unknown", result });
          say("unknown", result.message);
        }
      } catch (err) {
        setView({ kind: "idle" });
        say("failed", getErrorMessage(err, "Couldn't look that code up — check the connection and scan again"));
      }
    },
    [countItem, dirty, openParcel, say, view],
  );

  useWedgeScanner({ inputRef, onType: (ch) => setCode((c) => c + ch), onScan: (c) => void handleCode(c), paused: cameraOpen || correcting !== null });

  // Keep the scan box focused when nothing else is being used, so the next parcel can always be scanned.
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

  async function pick(orderId: string) {
    try {
      const p = await openParcel(orderId, view.kind === "candidates" ? view.result.code : null, view.kind === "candidates" ? view.result.matchedBy : null);
      say("scan", `${p.orderNumber} · ${p.customerName}`);
    } catch (err) {
      say("failed", getErrorMessage(err, "Couldn't open that parcel"));
    }
  }

  const parcel = view.kind === "parcel" ? view.parcel : null;
  const plan = parcel ? validate(parcel, form) : null;

  async function confirm() {
    if (!parcel || !plan?.ok) return;
    const input: ReceiveParcelInput = {
      orderId: parcel.orderId,
      version: parcel.version,
      code: view.kind === "parcel" ? view.code : null,
      ...(parcel.receive.mode === "DECIDE_OUTCOME" && form.outcome ? { outcome: form.outcome } : {}),
      lines: parcel.lines.map((l) => {
        const c = form.lines[l.orderItemId] ?? EMPTY;
        return { orderItemId: l.orderItemId, kept: c.kept, good: c.good, damaged: c.damaged, missing: c.missing, wrong: c.wrong, other: c.other, note: c.note.trim() || null };
      }),
      ...(plan.money ? { money: plan.money } : {}),
      note: form.note.trim() || null,
    };
    setSaving(true);
    setFeedback({ tone: "busy", text: `Saving ${parcel.orderNumber}…` });
    try {
      const res = await scansApi.receiveParcel(input);
      invalidateOrderQueries(queryClient);
      say("success", `${res.parcel.orderNumber} received${res.replayed ? " (already saved)" : ""} — ${summarise(res.receipt.lines)}. Scan the next parcel.`);
      toast.success(`${res.parcel.orderNumber} received`);
      setView({ kind: "idle" });
      inputRef.current?.focus();
    } catch (err) {
      const code = err instanceof ApiError ? (err.details as { code?: string } | undefined)?.code : undefined;
      say("failed", err instanceof ApiError && err.status > 0 ? getErrorMessage(err, "Not saved") : "Not saved — the connection dropped. Check it and press Confirm again; it will be saved once.");
      if (code === "PARCEL_CHANGED" || code === "NOTHING_TO_RECEIVE") {
        const fresh = await scansApi.getParcel(parcel.orderId).catch(() => null);
        if (fresh) setView({ kind: "parcel", parcel: fresh, code: view.kind === "parcel" ? view.code : null, matchedBy: view.kind === "parcel" ? view.matchedBy : null });
      }
    } finally {
      setSaving(false);
    }
  }

  const setLine = (id: string, patch: Partial<Counts>) => setForm((f) => ({ ...f, lines: { ...f.lines, [id]: { ...(f.lines[id] ?? EMPTY), ...patch } } }));

  // What is waiting to be received, by kind — only the ones with something in them, so the scanner stays near the top.
  // Partly delivered parcels are received here too (the receipt reconciles them), so they are counted with the rest.
  const queueCount = (id: string) => stats?.queueCounts?.[id as keyof NonNullable<typeof stats>["queueCounts"]] ?? 0;
  const queues = [
    { id: "comingBack", label: "Coming back", n: queueCount("comingBack"), href: "/admin/orders?f.queue=comingBack" },
    { id: "partialToReconcile", label: "Partly delivered", n: exceptions?.exceptions.partialToReconcile.count ?? 0, href: "/admin/orders?f.exception=partialToReconcile" },
    { id: "inspectionPending", label: "To inspect", n: queueCount("inspectionPending"), href: "/admin/orders?f.queue=inspectionPending" },
    { id: "scanDiscrepancy", label: "Discrepancy", n: queueCount("scanDiscrepancy"), href: "/admin/orders?f.queue=scanDiscrepancy" },
    { id: "returnOverdue", label: "Return overdue", n: queueCount("returnOverdue"), href: "/admin/orders?f.queue=returnOverdue" },
  ].filter((q) => q.n > 0);

  return (
    <div className="mt-4 space-y-4">
      <ScannerBar mode="RETURN" ready={focused} online={online} lastCode={lastCode} sound={sound.enabled} onSound={sound.setEnabled} />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {queues.map((q) => (
          <Link key={q.id} href={q.href} className="rounded-full bg-surface px-3 py-1.5 text-fg ring-1 ring-line-subtle hover:ring-line-strong">
            {q.label} <span className="tabular-nums text-fg-subtle">{formatCount(q.n)}</span>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleCode(code);
          }}
          className="flex gap-2"
        >
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Scan any code on the parcel, or type an order number or phone</span>
            <ScanLine size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
            <Input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Scan the parcel, or type an order number / phone"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              className="h-12 pl-10 text-base"
              data-testid="receive-scan-input"
            />
          </label>
          <Button type="button" variant="outline" className="h-12 w-12 shrink-0 px-0" aria-label="Scan with the camera" onClick={() => setCameraOpen(true)}>
            <Camera size={18} />
          </Button>
        </form>
        <div
          aria-live="assertive"
          role="status"
          data-testid="receive-feedback"
          data-tone={feedback?.tone ?? ""}
          className={cn(
            "mt-3 flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium",
            !feedback && "bg-surface-muted text-fg-muted",
            feedback?.tone === "ok" && "bg-success-50 text-success-800",
            feedback?.tone === "warn" && "bg-warning-50 text-warning-800",
            feedback?.tone === "error" && "bg-danger-50 text-danger-700",
            feedback?.tone === "busy" && "bg-info-50 text-info-800",
          )}
        >
          {feedback?.tone === "ok" && <CheckCircle2 size={16} aria-hidden="true" />}
          {feedback?.tone === "warn" && <AlertTriangle size={16} aria-hidden="true" />}
          {feedback?.tone === "error" && <XCircle size={16} aria-hidden="true" />}
          <span>{feedback?.text ?? "Scan any code on the returned parcel. Nothing changes until you confirm what came back."}</span>
        </div>
        {!online && (
          <p className="mt-2 flex items-center gap-2 text-xs text-info-800">
            <CloudOff size={13} aria-hidden="true" /> Offline — a receipt is saved only when the server confirms it.
          </p>
        )}
        {held && parcel && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-warning-200 bg-warning-50 px-3.5 py-2.5 text-sm text-warning-800" data-testid="held-scan">
            <span className="min-w-0 flex-1">
              You scanned <span className="font-mono">{held}</span> while {parcel.orderNumber} has unsaved entries.
            </span>
            <Button size="sm" variant="outline" onClick={() => setHeld(null)}>
              Keep editing
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void handleCode(held, { force: true })}>
              Discard and open it
            </Button>
          </div>
        )}
      </div>

      {view.kind === "loading" && <div className="h-48 rounded-2xl ui-skeleton" aria-hidden="true" />}

      {view.kind === "candidates" && (
        <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-label="Parcels this code may belong to" data-testid="candidates">
          <h2 className="text-sm font-semibold text-fg">
            {view.result.product ? `${view.result.product.name} (${view.result.product.sku})` : SCAN_MATCH_LABELS[view.result.matchedBy ?? "PHONE"]} — which parcel is in your hand?
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted">Check the name and area on the label. Nothing is chosen for you.</p>
          <ul className="mt-3 divide-y divide-line-subtle">
            {view.result.candidates.map((c) => (
              <li key={c.orderId} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">
                    {c.orderNumber} <span className="font-normal text-fg-muted">· {c.customerName}</span>
                  </p>
                  <p className="text-xs text-fg-muted">
                    {c.area} · {formatPrice(c.total)} · {formatStoreDate(c.createdAt)} · {c.status.toLowerCase().replace(/_/g, " ")}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void pick(c.orderId)} data-testid="candidate-pick">
                  This one
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.kind === "unknown" && <UnknownCode code={view.result.code} onOpened={(id) => void openParcel(id, view.result.code, "ALIAS")} onSay={say} />}

      {view.kind === "idle" && (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
          <PackageOpen size={28} className="text-fg-subtle" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-fg">Ready for the next parcel</p>
          <p className="mt-1 max-w-sm text-xs text-fg-muted">The Steadfast slip barcode, its QR, our label, the order number or the customer&apos;s phone all work. No return request is needed.</p>
        </div>
      )}

      {parcel && plan && (
        <section className="scroll-mt-32 space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5" aria-label={`Parcel ${parcel.orderNumber}`} data-testid="parcel-card">
          <ParcelHeader parcel={parcel} />
          {view.kind === "parcel" && view.matchedBy && <p className="text-xs text-fg-subtle">Opened by: {SCAN_MATCH_LABELS[view.matchedBy]}</p>}

          <div
            className={cn(
              "rounded-xl px-3.5 py-2.5 text-sm",
              parcel.receive.mode === "NOTHING" ? "bg-surface-muted text-fg-muted" : parcel.receive.mode === "INSPECT" ? "bg-info-50 text-info-800" : "bg-warning-50 text-warning-800",
            )}
            data-testid="receive-mode"
            data-mode={parcel.receive.mode}
          >
            {parcel.receive.message}
          </div>

          {parcel.receive.mode === "DECIDE_OUTCOME" && (
            <fieldset>
              <legend className="text-sm font-semibold text-fg">Did the customer keep anything?</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    { v: "FULL_RETURN", t: "Kept nothing", d: "The whole parcel came back. The order is cancelled — no SMS to the customer." },
                    { v: "PARTIAL", t: "Kept some", d: "What they kept stays sold. Say how many of each below." },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, outcome: o.v, lines: o.v === "FULL_RETURN" ? Object.fromEntries(Object.entries(f.lines).map(([k, l]) => [k, { ...l, kept: 0 }])) : f.lines }))}
                    aria-pressed={form.outcome === o.v}
                    data-testid={`outcome-${o.v.toLowerCase()}`}
                    className={cn("rounded-xl border px-3.5 py-3 text-left transition-colors", form.outcome === o.v ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-line hover:border-line-strong")}
                  >
                    <span className="block text-sm font-semibold text-fg">{o.t}</span>
                    <span className="mt-0.5 block text-xs text-fg-muted">{o.d}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-fg">What&apos;s in the parcel</h3>
              {parcel.receive.mode !== "NOTHING" && (
                <Button size="sm" variant="ghost" onClick={() => setForm((f) => ({ ...f, lines: Object.fromEntries(parcel.lines.map((l) => { const c = f.lines[l.orderItemId] ?? EMPTY; return [l.orderItemId, { ...EMPTY, kept: c.kept, note: c.note, good: capOf(l, c, parcel) }]; })) }))} data-testid="all-good">
                  All came back good
                </Button>
              )}
            </div>
            <p className="text-xs text-fg-muted">Only good units go back on sale. Scanning an item&apos;s own barcode counts it good.</p>
            <ul className="mt-2 divide-y divide-line-subtle">
              {parcel.lines.map((l) => {
                const c = form.lines[l.orderItemId] ?? EMPTY;
                const cap = capOf(l, c, parcel);
                const used = c.good + c.damaged + c.missing + c.wrong + c.other;
                const over = used > cap;
                const showKept = parcel.receive.mode === "RECONCILE" || (parcel.receive.mode === "DECIDE_OUTCOME" && form.outcome === "PARTIAL");
                return (
                  <li key={l.orderItemId} className="py-3" data-testid="receive-line">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg">{l.name}</p>
                        <p className="text-xs text-fg-muted">
                          <span className="font-mono">{l.sku}</span>
                          {[l.size, l.color].filter(Boolean).length ? ` · ${[l.size, l.color].filter(Boolean).join(", ")}` : ""}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-subtle">
                          Sent {l.ordered} · delivered {l.delivered} · returned {l.returned} · received {l.received}
                        </p>
                      </div>
                      {parcel.receive.mode !== "NOTHING" && (
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", over ? "bg-danger-100 text-danger-700" : used === cap && cap > 0 ? "bg-success-100 text-success-800" : "bg-ink-100 text-ink-700")} data-testid="line-accounted">
                          {used} / {cap}
                        </span>
                      )}
                    </div>
                    {parcel.receive.mode !== "NOTHING" && (
                      <>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                          {showKept && <Stepper label="Kept by customer" hint="Stays sold" value={c.kept} max={l.ordered - l.received} onChange={(v) => setLine(l.orderItemId, { kept: v })} testId="kept" />}
                          {FINDINGS.map((f) => (
                            <Stepper key={f.key} label={f.label} hint={f.hint} value={c[f.key]} max={999} onChange={(v) => setLine(l.orderItemId, { [f.key]: v })} testId={f.key} />
                          ))}
                        </div>
                        {(c.wrong > 0 || c.other > 0) && (
                          <Input className="mt-2" placeholder={c.wrong ? "What came back instead?" : "What did you find?"} value={c.note} maxLength={300} onChange={(e) => setLine(l.orderItemId, { note: e.target.value })} aria-label={`Note for ${l.name}`} />
                        )}
                        {over && <p className="mt-1 text-xs text-danger-700">Only {cap} can come back — you entered {used}.</p>}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {parcel.receive.mode !== "NOTHING" && parcel.money && <MoneyPanel parcel={parcel} form={form} setForm={setForm} plan={plan} />}

          {parcel.receive.mode !== "NOTHING" && (
            <>
              <Textarea placeholder="Note for the timeline (optional)" value={form.note} maxLength={500} rows={2} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} aria-label="Receipt note" />
              {plan.problem && <p className="text-sm text-warning-800" data-testid="receive-problem">{plan.problem}</p>}
              <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-surface/95 px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
                <Button className="min-h-[48px] flex-1 sm:flex-none" disabled={!plan.ok || saving || !online} loading={saving} onClick={() => void confirm()} data-testid="confirm-receipt">
                  <span className="sm:hidden">Confirm receipt</span>
                  <span className="hidden sm:inline">Physically received — confirm</span>
                </Button>
                <Button className="min-h-[48px] shrink-0" variant="outline" onClick={() => { setView({ kind: "idle" }); setHeld(null); }}>
                  Cancel
                </Button>
              </div>
            </>
          )}

          <details className="rounded-xl border border-line-subtle px-3.5 py-2.5">
            <summary className="cursor-pointer text-sm font-medium text-fg">History of this parcel</summary>
            <div className="mt-2">
              <ParcelHistory parcel={parcel} onCorrect={(id) => setCorrecting(id)} />
            </div>
          </details>
        </section>
      )}

      {cameraOpen && <CameraScanner onClose={() => setCameraOpen(false)} onCode={(value) => { setCameraOpen(false); void handleCode(value); }} />}
      {correcting && parcel && (
        <CorrectionDialog
          parcel={parcel}
          receiptId={correcting}
          onClose={() => setCorrecting(null)}
          onDone={(fresh) => {
            setCorrecting(null);
            setView({ kind: "parcel", parcel: fresh, code: view.kind === "parcel" ? view.code : null, matchedBy: view.kind === "parcel" ? view.matchedBy : null });
            invalidateOrderQueries(queryClient);
            say("success", `${fresh.orderNumber}: receipt corrected`);
          }}
          onError={(msg) => say("failed", msg)}
        />
      )}
    </div>
  );
}

/** The most units of a line this receipt can account for. */
function capOf(l: ParcelLineView, c: Counts, parcel: ParcelView) {
  return decides(parcel) ? Math.max(0, l.ordered - l.received - c.kept) : l.awaiting;
}

function validate(parcel: ParcelView, form: { outcome: "FULL_RETURN" | "PARTIAL" | null; lines: Record<string, Counts>; money: { actual: string; charge: string; reason: ParcelMoneyReason | ""; note: string } }) {
  const fail = (problem: string) => ({ ok: false as const, problem, money: null, expected: parcel.money?.expectedCod ?? 0 });
  const expected = parcel.money?.expectedCod ?? 0;
  if (parcel.receive.mode === "NOTHING") return { ok: false as const, problem: null, money: null, expected };
  if (parcel.receive.mode === "DECIDE_OUTCOME" && !form.outcome) return fail("Choose whether the customer kept anything.");
  let accounted = 0;
  let kept = 0;
  for (const l of parcel.lines) {
    const c = form.lines[l.orderItemId] ?? EMPTY;
    const used = c.good + c.damaged + c.missing + c.wrong + c.other;
    if (used > capOf(l, c, parcel)) return fail(`${l.name}: more than can come back.`);
    accounted += used;
    kept += c.kept;
  }
  if (form.outcome === "PARTIAL" && parcel.receive.mode === "DECIDE_OUTCOME" && kept === 0) return fail("Say what the customer kept, or choose “Kept nothing”.");
  if (accounted === 0) return fail("Count what came back — good, damaged, missing, wrong or other.");
  let money: ReceiveParcelInput["money"] | null = null;
  if (form.money.actual.trim() !== "") {
    const actual = Number(form.money.actual);
    if (!Number.isFinite(actual) || actual < 0) return fail("Enter the amount the courier handed over, or leave it empty.");
    const charge = form.money.charge.trim() === "" ? null : Number(form.money.charge);
    if (charge !== null && (!Number.isFinite(charge) || charge < 0)) return fail("Enter the courier charge as a number, or leave it empty.");
    if (actual !== expected && !form.money.reason) return fail("The amount differs from the expected COD — choose a reason.");
    money = { actualCollected: actual, courierCharge: charge, reason: form.money.reason || null, note: form.money.note.trim() || null };
  }
  return { ok: true as const, problem: null, money, expected };
}

function summarise(lines: Array<{ good?: number; damaged?: number; missing?: number; wrong?: number; other?: number; kept?: number }>) {
  const sum = (k: "good" | "damaged" | "missing" | "wrong" | "other" | "kept") => lines.reduce((s, l) => s + (l[k] ?? 0), 0);
  return [
    sum("kept") ? `${sum("kept")} kept` : "",
    `${sum("good")} good`,
    sum("damaged") ? `${sum("damaged")} damaged` : "",
    sum("missing") ? `${sum("missing")} missing` : "",
    sum("wrong") ? `${sum("wrong")} wrong` : "",
    sum("other") ? `${sum("other")} other` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function Stepper({ label, hint, value, max, onChange, testId }: { label: string; hint: string; value: number; max: number; onChange: (v: number) => void; testId: string }) {
  return (
    <div className={cn("rounded-xl border px-2.5 py-2", value > 0 ? "border-line-strong bg-surface" : "border-line-subtle bg-surface-muted/60")} data-testid={`stepper-${testId}`}>
      <p className="text-xs font-medium text-fg">{label}</p>
      <p className="text-[11px] text-fg-subtle">{hint}</p>
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <button type="button" aria-label={`One less ${label.toLowerCase()}`} disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 1))} className="flex h-9 w-9 items-center justify-center rounded-full text-fg ring-1 ring-line hover:bg-ink-900/[0.05] disabled:opacity-40">
          <Minus size={14} />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))}
          aria-label={label}
          className="h-9 w-12 rounded-lg bg-transparent text-center text-base font-semibold tabular-nums text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button type="button" aria-label={`One more ${label.toLowerCase()}`} onClick={() => onChange(Math.min(max, value + 1))} className="flex h-9 w-9 items-center justify-center rounded-full text-fg ring-1 ring-line hover:bg-ink-900/[0.05]">
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

type FormState = { outcome: "FULL_RETURN" | "PARTIAL" | null; lines: Record<string, Counts>; money: { actual: string; charge: string; reason: ParcelMoneyReason | ""; note: string }; note: string };

function MoneyPanel({ parcel, form, setForm, plan }: { parcel: ParcelView; form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>>; plan: { expected: number } }) {
  const m = parcel.money!;
  const symbol = storeCurrencySymbol();
  const actual = form.money.actual.trim() === "" ? null : Number(form.money.actual);
  const diff = actual === null || !Number.isFinite(actual) ? null : actual - plan.expected;
  const set = (patch: Partial<FormState["money"]>) => setForm((f) => ({ ...f, money: { ...f.money, ...patch } }));
  return (
    <section className="rounded-xl border border-line-subtle p-3.5" aria-label="Money from the courier" data-testid="money-panel">
      <h3 className="text-sm font-semibold text-fg">Money from the courier</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-fg-muted">Expected COD</dt>
          <dd className="font-semibold tabular-nums text-fg" data-testid="expected-cod">{formatPrice(m.expectedCod)}</dd>
        </div>
        {m.courierReported !== null && (
          <div>
            <dt className="text-xs text-fg-muted">Steadfast says collected</dt>
            <dd className="font-semibold tabular-nums text-fg">{formatPrice(m.courierReported)}</dd>
          </div>
        )}
        {diff !== null && (
          <div>
            <dt className="text-xs text-fg-muted">Difference</dt>
            <dd className={cn("font-semibold tabular-nums", diff === 0 ? "text-success-700" : "text-warning-800")} data-testid="money-diff">
              {diff > 0 ? "+" : ""}
              {formatPrice(diff)}
            </dd>
          </div>
        )}
      </dl>
      {m.recorded.length > 0 ? (
        <p className="mt-2 text-sm text-fg-muted" data-testid="money-recorded">
          Already recorded: {m.recorded.map((p) => `${formatPrice(p.amount)} ${p.purpose === "RETURN_CHARGE" ? "return charge" : "COD"}`).join(", ")}. Change it on the order&apos;s Payments.
        </p>
      ) : !m.canRecord ? (
        <p className="mt-2 text-sm text-fg-muted">Recording the courier&apos;s money needs the Payments permission — the parcel can still be received.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs font-medium text-fg">
              Actually received ({symbol})
              <Input className="mt-1" inputMode="decimal" placeholder="Leave empty if none" value={form.money.actual} onChange={(e) => set({ actual: e.target.value.replace(/[^\d.]/g, "") })} data-testid="money-actual" />
              {m.courierReported !== null && form.money.actual === "" && (
                <button type="button" className="mt-1 text-xs font-medium text-fg underline-offset-2 hover:underline" onClick={() => set({ actual: String(m.courierReported) })}>
                  Use Steadfast&apos;s {formatPrice(m.courierReported)}
                </button>
              )}
            </label>
            {m.canRecordCharge && (
              <label className="block text-xs font-medium text-fg">
                Courier charge ({symbol})
                <Input className="mt-1" inputMode="decimal" placeholder="Optional" value={form.money.charge} onChange={(e) => set({ charge: e.target.value.replace(/[^\d.]/g, "") })} data-testid="money-charge" />
              </label>
            )}
            <label className="block text-xs font-medium text-fg">
              Reason{diff !== null && diff !== 0 ? " (required)" : ""}
              <Select className="mt-1" value={form.money.reason} onChange={(e) => set({ reason: e.target.value as ParcelMoneyReason | "" })} data-testid="money-reason">
                <option value="">Choose…</option>
                {PARCEL_MONEY_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {PARCEL_MONEY_REASON_LABELS[r]}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {diff !== null && diff !== 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-warning-800">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              Differs from the expected COD. What the customer kept is paid first; the rest is recorded as a return charge (courier cost recovered) — never as a sale.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function UnknownCode({ code, onOpened, onSay }: { code: string; onOpened: (orderId: string) => void; onSay: (tone: ScannerTone, text: string) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  async function link() {
    setBusy(true);
    try {
      const found = await scansApi.resolveCode(q.trim(), "RETURN");
      if (found.kind !== "ORDER" || !found.orderId) {
        onSay("unknown", found.kind === "CANDIDATES" ? "That matches several parcels — type the order number" : `No order ${q.trim()}`);
        return;
      }
      await scansApi.linkCode(code, found.orderId);
      onSay("success", `${code} now opens ${found.message}`);
      onOpened(found.orderId);
    } catch (err) {
      onSay("failed", getErrorMessage(err, "Couldn't link the code"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-2xl border border-danger-200 bg-surface p-4 sm:p-5" data-testid="unknown-code">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <XCircle size={16} className="text-danger-600" aria-hidden="true" /> Unknown code — nothing was changed
      </h2>
      <p className="mt-1 break-all font-mono text-xs text-fg-muted">{code}</p>
      <p className="mt-2 text-sm text-fg-muted">If this parcel is ours, find its order (the number on our label, or the customer&apos;s phone) and link the code — next time it opens straight away.</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) void link();
        }}
      >
        <Input className="min-w-0 flex-1" placeholder="Order number, e.g. ORD-20261025-8HSXRG" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Order number to link" />
        <Button type="submit" variant="outline" loading={busy} disabled={!q.trim()}>
          <Link2 size={15} aria-hidden="true" /> Link and open
        </Button>
      </form>
    </section>
  );
}

function CorrectionDialog({ parcel, receiptId, onClose, onDone, onError }: { parcel: ParcelView; receiptId: string; onClose: () => void; onDone: (p: ParcelView) => void; onError: (m: string) => void }) {
  const receipt = parcel.receipts.find((r) => r.id === receiptId);
  const items = parcel.lines.filter((l) => receipt?.lines.some((x) => x.orderItemId === l.orderItemId && ((x.good ?? 0) > 0 || (x.damaged ?? 0) > 0)));
  const [orderItemId, setOrderItemId] = useState(items[0]?.orderItemId ?? "");
  const [from, setFrom] = useState<"GOOD" | "DAMAGED">("GOOD");
  const [to, setTo] = useState<"GOOD" | "DAMAGED" | "UNRESOLVED">("DAMAGED");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const res = await scansApi.correctReceipt(receiptId, { reason: reason.trim(), lines: [{ orderItemId, from, to, quantity }] });
      onDone(res.parcel);
    } catch (err) {
      onError(getErrorMessage(err, "Couldn't correct the receipt"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Correct this receipt"
      description="Fixed with new entries that undo the mistake — the original receipt and stock entries stay in the history."
      widthClassName="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!orderItemId || from === to || reason.trim().length < 3 || quantity < 1} onClick={() => void submit()} data-testid="correction-submit">
            Save correction
          </Button>
        </div>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing on this receipt was counted good or damaged — receive the waiting units instead.</p>
      ) : (
        <div className="space-y-3">
          <label className="block text-xs font-medium text-fg">
            Item
            <Select className="mt-1" value={orderItemId} onChange={(e) => setOrderItemId(e.target.value)}>
              {items.map((l) => (
                <option key={l.orderItemId} value={l.orderItemId}>
                  {l.name} ({l.sku})
                </option>
              ))}
            </Select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs font-medium text-fg">
              Counted as
              <Select className="mt-1" value={from} onChange={(e) => setFrom(e.target.value as "GOOD" | "DAMAGED")}>
                <option value="GOOD">Good</option>
                <option value="DAMAGED">Damaged</option>
              </Select>
            </label>
            <label className="block text-xs font-medium text-fg">
              Actually
              <Select className="mt-1" value={to} onChange={(e) => setTo(e.target.value as "GOOD" | "DAMAGED" | "UNRESOLVED")}>
                <option value="GOOD">Good</option>
                <option value="DAMAGED">Damaged</option>
                <option value="UNRESOLVED">Never in the parcel</option>
              </Select>
            </label>
            <label className="block text-xs font-medium text-fg">
              How many
              <Input className="mt-1" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </label>
          </div>
          <label className="block text-xs font-medium text-fg">
            What was wrong (required)
            <Textarea className="mt-1" rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
      )}
    </Modal>
  );
}
