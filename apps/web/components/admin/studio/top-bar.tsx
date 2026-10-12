"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  History,
  Lightbulb,
  Monitor,
  MoreHorizontal,
  Redo2,
  RotateCcw,
  Smartphone,
  Tablet,
  Undo2,
} from "lucide-react";
import type { StudioCheck, StudioSection } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Popover } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { SegmentedControl } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { listStudioRevisions } from "@/lib/api/admin-homepage-studio";
import type { StudioDevice } from "@/lib/studio/preview-protocol";
import type { StudioDraft } from "@/lib/studio/use-studio-draft";
import { cn } from "@/lib/utils";
import { SECTION_META } from "./section-meta";

const DEVICES: { value: StudioDevice; label: string; icon: typeof Monitor }[] = [
  { value: "desktop", label: "Computer", icon: Monitor },
  { value: "tablet", label: "Tablet", icon: Tablet },
  { value: "mobile", label: "Phone", icon: Smartphone },
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

function timeAgo(date: Date) {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

interface TopBarProps {
  draft: StudioDraft;
  device: StudioDevice;
  onDevice: (device: StudioDevice) => void;
  checks: StudioCheck[];
  onPublish: () => void;
  onDiscard: () => void;
  onRestore: (revisionId: string, publishedAt: string) => void;
  onSelectSection: (id: string) => void;
}

export function TopBar({ draft, device, onDevice, checks, onPublish, onDiscard, onRestore, onSelectSection }: TopBarProps) {
  const errors = checks.filter((c) => c.level === "error");
  const blocking = errors.length > 0;
  const moreRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line-subtle bg-surface px-3" data-testid="studio-top-bar">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Tooltip content="Back to the admin">
          <Link href="/admin" aria-label="Back to the admin" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-ink-900/[0.05] hover:text-fg">
            <ArrowLeft size={18} />
          </Link>
        </Tooltip>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-fg">Homepage</h1>
          <SaveStatus draft={draft} />
        </div>
      </div>

      <SegmentedControl
        aria-label="Preview size"
        size="sm"
        value={device}
        onChange={onDevice}
        options={DEVICES.map(({ value, label, icon: Icon }) => ({
          value,
          ariaLabel: label,
          testId: `studio-device-${value}`,
          label: (
            <span className="flex items-center gap-1.5">
              <Icon size={15} aria-hidden="true" />
              <span className="hidden xl:inline">{label}</span>
            </span>
          ),
        }))}
      />

      <div className="flex flex-1 items-center justify-end gap-1">
        <Tooltip content={`Undo (${MOD}Z)`}>
          <IconButton aria-label="Undo" disabled={!draft.canUndo} onClick={draft.undo}>
            <Undo2 size={17} />
          </IconButton>
        </Tooltip>
        <Tooltip content={`Redo (${isMac ? "⇧⌘Z" : "Ctrl+Y"})`}>
          <IconButton aria-label="Redo" disabled={!draft.canRedo} onClick={draft.redo}>
            <Redo2 size={17} />
          </IconButton>
        </Tooltip>
        <ChecksButton checks={checks} onSelectSection={onSelectSection} sections={draft.sections} />
        <HistoryButton onRestore={onRestore} />
        <Tooltip content="Open the live homepage">
          <a href="/" target="_blank" rel="noopener noreferrer" aria-label="Open the live homepage in a new tab" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500 hover:bg-ink-900/[0.06] hover:text-fg">
            <ExternalLink size={17} />
          </a>
        </Tooltip>
        <IconButton ref={moreRef} aria-label="More actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
          <MoreHorizontal size={18} />
        </IconButton>
        <DropdownMenu
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          anchorRef={moreRef}
          label="More actions"
          items={[{ label: "Discard unpublished changes", icon: RotateCcw, destructive: true, disabled: !draft.hasUnpublishedChanges, onClick: onDiscard }]}
        />
        <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
        <Tooltip content={blocking ? `Fix ${errors.length === 1 ? "1 section" : `${errors.length} sections`} first` : draft.hasUnpublishedChanges ? "Make these changes live" : "Nothing new to publish"}>
          <span>
            <Button
              onClick={onPublish}
              disabled={blocking || !draft.hasUnpublishedChanges || draft.publishing || draft.saveState === "conflict"}
              loading={draft.publishing}
              data-testid="studio-publish"
            >
              Publish
            </Button>
          </span>
        </Tooltip>
      </div>
    </header>
  );
}

function SaveStatus({ draft }: { draft: StudioDraft }) {
  const { saveState, savedAt, hasUnpublishedChanges } = draft;
  if (saveState === "conflict") {
    return (
      <p className="flex items-center gap-1 text-xs text-danger-600">
        <AlertTriangle size={12} aria-hidden="true" /> Changed elsewhere —{" "}
        <button type="button" className="font-medium underline" onClick={() => void draft.reload()}>
          reload
        </button>
      </p>
    );
  }
  if (saveState === "error") return <p className="text-xs text-danger-600">Couldn&rsquo;t save — retrying on your next change</p>;
  if (saveState === "saving") {
    return (
      <p className="flex items-center gap-1 text-xs text-fg-muted" aria-live="polite">
        <Spinner size={10} /> Saving…
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-fg-muted" aria-live="polite" data-testid="studio-save-status">
      {hasUnpublishedChanges ? (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-warning-500" aria-hidden="true" />
          Draft{savedAt ? ` saved ${timeAgo(savedAt)}` : ""} · not live yet
        </>
      ) : (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-success-500" aria-hidden="true" /> Live — everything is published
        </>
      )}
    </p>
  );
}

const LEVEL = {
  error: { icon: CircleAlert, className: "text-danger-600", label: "Fix before publishing" },
  warning: { icon: AlertTriangle, className: "text-warning-600", label: "Worth a look" },
  tip: { icon: Lightbulb, className: "text-info-600", label: "Tips" },
} as const;

function ChecksButton({ checks, sections, onSelectSection }: { checks: StudioCheck[]; sections: StudioSection[]; onSelectSection: (id: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const serious = checks.filter((c) => c.level !== "tip").length;
  const worst = checks.some((c) => c.level === "error") ? "danger" : checks.some((c) => c.level === "warning") ? "warning" : null;

  return (
    <>
      <Tooltip content="Page checks">
        <button
          ref={ref}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={`Page checks: ${serious} to look at`}
          aria-expanded={open}
          className="relative flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm text-ink-500 hover:bg-ink-900/[0.06] hover:text-fg"
          data-testid="studio-checks"
        >
          {worst ? <AlertTriangle size={16} className={worst === "danger" ? "text-danger-600" : "text-warning-600"} /> : <CheckCircle2 size={16} className="text-success-600" />}
          {serious > 0 && <span className="tabular-nums">{serious}</span>}
        </button>
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="end" aria-label="Page checks" className="w-[360px] p-0">
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {checks.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-4 text-sm text-fg-muted">
              <CheckCircle2 size={16} className="text-success-600" /> Everything looks good.
            </p>
          ) : (
            (["error", "warning", "tip"] as const).map((level) => {
              const items = checks.filter((c) => c.level === level);
              if (items.length === 0) return null;
              const { icon: Icon, className, label } = LEVEL[level];
              return (
                <section key={level} className="py-1">
                  <p className="px-3 pb-1 pt-2 text-caption font-semibold uppercase text-fg-subtle">{label}</p>
                  <ul>
                    {items.map((check, i) => {
                      const section = sections.find((s) => s.id === check.sectionId);
                      return (
                        <li key={`${check.code}-${check.sectionId}-${i}`}>
                          <button
                            type="button"
                            disabled={!section}
                            onClick={() => {
                              if (section) onSelectSection(section.id);
                              setOpen(false);
                            }}
                            className="flex w-full gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-ink-900/[0.04] disabled:hover:bg-transparent"
                          >
                            <Icon size={15} className={cn("mt-0.5 shrink-0", className)} aria-hidden="true" />
                            <span className="min-w-0">
                              {section && <span className="block text-xs font-medium text-fg">{SECTION_META[section.type].label}</span>}
                              <span className="block text-xs leading-relaxed text-fg-muted">{check.message}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </Popover>
    </>
  );
}

function HistoryButton({ onRestore }: { onRestore: (revisionId: string, publishedAt: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({ queryKey: ["studio-revisions"], queryFn: listStudioRevisions, enabled: open });
  const revisions = data?.revisions ?? [];

  return (
    <>
      <Tooltip content="Publish history">
        <IconButton ref={ref} aria-label="Publish history" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="studio-history">
          <History size={17} />
        </IconButton>
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="end" aria-label="Publish history" className="w-[320px] p-0">
        <p className="border-b border-line-subtle px-4 py-3 text-xs text-fg-muted">Bring back an earlier version as your draft — nothing changes on the live page until you publish.</p>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {isLoading && (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-fg-muted">
              <Spinner /> Loading…
            </p>
          )}
          {isError && <p className="px-3 py-3 text-sm text-danger-600">Couldn&rsquo;t load the history.</p>}
          {!isLoading && !isError && revisions.length === 0 && <p className="px-3 py-3 text-sm text-fg-muted">Each time you publish, the page is kept here.</p>}
          <ul>
            {revisions.map((r, i) => (
              <li key={r.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-ink-900/[0.04]">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm text-fg">
                    {new Date(r.publishedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    {i === 0 && <Badge variant="success">Live</Badge>}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    {r.publishedByName ?? "Someone"} · {r.sectionCount} sections
                  </span>
                </span>
                {i > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOpen(false);
                      onRestore(r.id, r.publishedAt);
                    }}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Popover>
    </>
  );
}
