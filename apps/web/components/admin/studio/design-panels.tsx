"use client";

import { RotateCcw } from "lucide-react";
import { validateStorefrontDesign, type StorefrontDesign, type StorefrontDesignGroup, type StudioCheck } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StoreLayout } from "@/lib/theme-layout";
import type { StudioDraft } from "@/lib/studio/use-studio-draft";
import { FieldList, type FieldContext } from "./field-controls";
import { DESIGN_FIELDS } from "./design-fields";
import { DESIGN_GROUPS, DESIGN_META, designSelectionId } from "./design-meta";

/** One line saying what a design group currently does — the outline's second line. */
function summaryOf(group: StorefrontDesignGroup, design: StorefrontDesign): string {
  switch (group) {
    case "theme": {
      const t = design.theme ?? {};
      const parts = [t.accent && `Brand colour ${t.accent.toUpperCase()}`, t.headingFont && "own fonts", t.corners && `${t.corners} corners`, t.bands && `${t.bands} sections`].filter(Boolean);
      return parts.length ? parts.join(" · ") : "Your theme as designed";
    }
    case "announcement": {
      const a = design.announcement;
      if (!a?.enabled) return "Off";
      const n = a.messages?.length ?? 0;
      return n === 1 ? (a.messages[0]?.text ?? "1 message") : `${n} messages, taking turns`;
    }
    case "header": {
      const n = design.header?.menuLinks?.length ?? 0;
      return n ? `${n} menu link${n === 1 ? "" : "s"} before the categories` : "Categories only";
    }
    case "footer": {
      const f = design.footer;
      const parts = [f?.about && "own about text", f?.links?.length && `${f.links.length} extra links`, f?.showNewsletter === false && "no newsletter"].filter(Boolean);
      return parts.length ? parts.join(" · ") : "Standard footer";
    }
  }
}

interface DesignOutlineProps {
  design: StorefrontDesign;
  selectedId: string | null;
  checks: StudioCheck[];
  onSelect: (id: string) => void;
}

/** The Site design tab's list: the four store-wide parts of the look, each opening its settings on the right. */
export function DesignOutline({ design, selectedId, checks, onSelect }: DesignOutlineProps) {
  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <p className="px-2 pb-2 text-caption font-semibold uppercase text-fg-subtle">Every page of your store</p>
      <ul className="space-y-1">
        {DESIGN_GROUPS.map((group) => {
          const id = designSelectionId(group);
          const meta = DESIGN_META[group];
          const Icon = meta.icon;
          const selected = selectedId === id;
          const level = checks.some((c) => c.sectionId === id && c.level === "error")
            ? "error"
            : checks.some((c) => c.sectionId === id && c.level === "warning")
              ? "warning"
              : null;
          return (
            <li key={group}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                aria-current={selected ? "true" : undefined}
                data-testid={`design-row-${group}`}
                className={cn(
                  "flex min-h-12 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors duration-fast",
                  selected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-ink-900/[0.04]",
                )}
              >
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-fg shadow-xs ring-1 ring-line-subtle">
                  <Icon size={15} aria-hidden="true" />
                  {level && (
                    <span
                      className={cn("absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface", level === "error" ? "bg-danger-500" : "bg-warning-500")}
                      aria-label={level === "error" ? "Needs fixing" : "Has a suggestion"}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{meta.label}</span>
                  <span className="block truncate text-xs text-fg-muted">{summaryOf(group, design)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface DesignInspectorProps {
  draft: StudioDraft;
  group: StorefrontDesignGroup;
  layout: StoreLayout;
  categories: { slug: string; name: string }[];
  checks: StudioCheck[];
}

/** Settings for one Site design group, live in the preview and saved with the draft like any section edit. */
export function DesignInspector({ draft, group, layout, categories, checks }: DesignInspectorProps) {
  const meta = DESIGN_META[group];
  const Icon = meta.icon;
  const config = ((draft.design as Record<string, unknown>)[group] ?? {}) as Record<string, unknown>;
  const allErrors = validateStorefrontDesign(draft.design).fields;
  const errors = Object.fromEntries(
    Object.entries(allErrors)
      .filter(([path]) => path.startsWith(`${group}.`))
      .map(([path, message]) => [path.slice(group.length + 1), message]),
  );
  const context: FieldContext = { idPrefix: `design-${group}`, layout, categories, errors };
  const customised = Object.keys(config).length > 0;

  return (
    <div className="flex h-full flex-col" data-testid="design-inspector">
      <header className="border-b border-line-subtle px-5 pb-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg">
            <Icon size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-fg">{meta.label}</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{meta.description}</p>
          </div>
          {customised && (
            <Button variant="ghost" size="sm" onClick={() => draft.updateDesign(group, {})}>
              <RotateCcw size={14} aria-hidden="true" /> Reset
            </Button>
          )}
        </div>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {checks.length > 0 && (
          <ul className="space-y-2" aria-label="Checks for this part">
            {checks.map((check, i) => (
              <li key={`${check.code}-${i}`}>
                <Alert variant={check.level === "error" ? "danger" : check.level === "warning" ? "warning" : "info"}>{check.message}</Alert>
              </li>
            ))}
          </ul>
        )}
        <FieldList fields={DESIGN_FIELDS[group]} config={config} onChange={(next, coalesceKey) => draft.updateDesign(group, next, coalesceKey)} context={context} />
        {group === "theme" && <p className="text-xs leading-relaxed text-fg-subtle">Applies to every page — the preview shows it on the homepage. Shoppers see it after you publish.</p>}
      </div>
    </div>
  );
}
