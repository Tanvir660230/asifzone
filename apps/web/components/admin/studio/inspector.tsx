"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Copy, Trash2 } from "lucide-react";
import { REPEATABLE_SECTION_TYPES, studioFieldErrors, type StudioCheck, type StudioSection } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { toDatetimeLocalValue } from "@/lib/datetime-local";
import type { StoreLayout } from "@/lib/theme-layout";
import type { StudioDraft } from "@/lib/studio/use-studio-draft";
import { FieldList, type FieldContext } from "./field-controls";
import { SECTION_FIELDS, SHOW_ON_FIELD, SPACING_FIELD, visibleFields } from "./section-fields";
import { SECTION_META } from "./section-meta";

type Tab = "content" | "style" | "visibility";

interface InspectorProps {
  draft: StudioDraft;
  section: StudioSection;
  layout: StoreLayout;
  categories: { slug: string; name: string }[];
  /** This section's page-health findings. */
  checks: StudioCheck[];
  /** Switched on, but takes no space at the previewed width. */
  emptyOnDevice: boolean;
  onDelete: (section: StudioSection) => void;
}

const fromLocal = (value: string) => (value ? new Date(value).toISOString() : null);

/** The right-hand panel: everything about the selected section — its words and pictures, how it looks, and when and
 * where it shows. Every change is live in the preview and autosaved to the draft. */
export function Inspector({ draft, section, layout, categories, checks, emptyOnDevice, onDelete }: InspectorProps) {
  const [tab, setTab] = useState<Tab>("content");
  const meta = SECTION_META[section.type];
  const Icon = meta.icon;
  const fields = SECTION_FIELDS[section.type];
  const config = section.config;
  const repeatable = REPEATABLE_SECTION_TYPES.includes(section.type);
  const errors = studioFieldErrors(section);
  const context: FieldContext = { idPrefix: `s-${section.id}`, layout, categories, errors };
  const onConfig = (next: Record<string, unknown>, coalesceKey?: string) => draft.updateConfig(section.id, next, coalesceKey);

  const contentFields = visibleFields(fields.content, config, layout);
  const styleFields = [SPACING_FIELD, ...fields.style];
  const tabErrors = (keys: string[]) => Object.keys(errors).some((path) => keys.some((k) => path === k || path.startsWith(`${k}.`)));
  const contentHasErrors = tabErrors(fields.content.map((f) => f.key)) || Boolean(errors[""]);

  return (
    <div className="flex h-full flex-col" data-testid="studio-inspector">
      <header className="border-b border-line-subtle px-5 pb-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg">
            <Icon size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-fg">{meta.label}</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{meta.description}</p>
          </div>
          {repeatable && (
            <div className="flex shrink-0 gap-0.5">
              <Tooltip content="Duplicate">
                <IconButton aria-label="Duplicate section" onClick={() => draft.duplicate(section.id)}>
                  <Copy size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip content="Delete">
                <IconButton variant="danger" aria-label="Delete section" onClick={() => onDelete(section)}>
                  <Trash2 size={16} />
                </IconButton>
              </Tooltip>
            </div>
          )}
        </div>
        {meta.managedElsewhere && (
          <Link href={meta.managedElsewhere.href} className="mt-3 flex items-center gap-1 text-xs text-accent hover:underline">
            {meta.managedElsewhere.label} <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        )}
        <SegmentedControl
          aria-label="Section settings"
          className="mt-4 w-full"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "content", label: contentHasErrors ? "Content •" : "Content", ariaLabel: contentHasErrors ? "Content, needs fixing" : "Content", testId: "inspector-tab-content" },
            { value: "style", label: "Style", testId: "inspector-tab-style" },
            { value: "visibility", label: "Visibility", testId: "inspector-tab-visibility" },
          ]}
        />
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {!section.isActive && (
          <Alert variant="neutral" title="Switched off">
            Shoppers don&rsquo;t see this section. Turn it on in Visibility.
          </Alert>
        )}
        {section.isActive && emptyOnDevice && (
          <Alert variant="info">Not shown at this screen size — it&rsquo;s hidden on this device or has nothing to show yet.</Alert>
        )}
        {checks.length > 0 && (
          <ul className="space-y-2" aria-label="Checks for this section">
            {checks.map((check, i) => (
              <li key={`${check.code}-${i}`}>
                <Alert variant={check.level === "error" ? "danger" : check.level === "warning" ? "warning" : "info"}>{check.message}</Alert>
              </li>
            ))}
          </ul>
        )}

        {tab === "content" &&
          (contentFields.length > 0 ? (
            <FieldList fields={fields.content} config={config} onChange={onConfig} context={context} />
          ) : (
            <p className="text-sm text-fg-muted">This section fills itself in — there is nothing to write here. Use Style and Visibility to place it.</p>
          ))}

        {tab === "style" && (
          <>
            <FieldList fields={styleFields} config={config} onChange={onConfig} context={context} />
            {layout === "mihrab" && fields.style.some((f) => f.presets && !f.presets.includes("mihrab")) && (
              <p className="text-xs text-fg-subtle">Some options aren&rsquo;t used by this store&rsquo;s theme, which composes the section its own way.</p>
            )}
          </>
        )}

        {tab === "visibility" && (
          <>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-fg">Show on the homepage</p>
                <p className="text-xs text-fg-muted">Off keeps it in the draft without showing it.</p>
              </div>
              <Switch aria-label="Show on the homepage" checked={section.isActive} onChange={(isActive) => draft.update(section.id, { isActive })} />
            </div>
            <FieldList fields={[SHOW_ON_FIELD]} config={config} onChange={onConfig} context={context} />
            <div className="space-y-4">
              <p className="ui-label">Schedule (optional)</p>
              <Field htmlFor={`${context.idPrefix}-starts`} label="Visible from">
                <Input
                  id={`${context.idPrefix}-starts`}
                  type="datetime-local"
                  value={toDatetimeLocalValue(section.startsAt)}
                  onChange={(e) => draft.update(section.id, { startsAt: fromLocal(e.target.value) })}
                />
              </Field>
              <Field htmlFor={`${context.idPrefix}-ends`} label="Visible until" hint="For a sale or a festival banner — it switches itself off.">
                <Input
                  id={`${context.idPrefix}-ends`}
                  type="datetime-local"
                  value={toDatetimeLocalValue(section.endsAt)}
                  onChange={(e) => draft.update(section.id, { endsAt: fromLocal(e.target.value) })}
                />
              </Field>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
