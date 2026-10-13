"use client";

import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, LayoutTemplate, Plus } from "lucide-react";
import type { StudioCheck, StudioSection } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { SECTION_META } from "./section-meta";

interface OutlineProps {
  sections: StudioSection[];
  selectedId: string | null;
  checks: StudioCheck[];
  /** Switched on but taking no space at the previewed width. */
  emptyIds: Set<string>;
  deviceLabel: string;
  onSelect: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onToggle: (id: string, isActive: boolean) => void;
  onAdd: () => void;
  readOnly?: boolean;
}

/** The page's sections top to bottom — what's on, what's scheduled, what needs attention. Drag (or Alt+↑/↓ on a focused
 * row) to reorder; the eye switches a section off without deleting it. */
export function Outline({ sections, selectedId, checks, emptyIds, deviceLabel, onSelect, onMove, onToggle, onAdd, readOnly = false }: OutlineProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = sections.map((s) => s.id);

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    onMove(ids.indexOf(active.id as string), ids.indexOf(over.id as string));
  }

  if (sections.length === 0) {
    return (
      <EmptyState
        icon={LayoutTemplate}
        title="No sections yet"
        description="Add a section to start building your homepage."
        action={readOnly ? undefined : <Button onClick={onAdd}>Add section</Button>}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <p className="px-2 pb-2 text-caption font-semibold uppercase text-fg-subtle">Sections · top to bottom</p>
        <DndContext id="studio-outline-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="space-y-1" aria-label="Homepage sections, top to bottom">
              {sections.map((section, i) => (
                <OutlineRow
                  key={section.id}
                  section={section}
                  selected={section.id === selectedId}
                  checks={checks.filter((c) => c.sectionId === section.id)}
                  hiddenHere={section.isActive && emptyIds.has(section.id)}
                  deviceLabel={deviceLabel}
                  onSelect={() => onSelect(section.id)}
                  onToggle={() => onToggle(section.id, !section.isActive)}
                  onMoveBy={(offset) => onMove(i, i + offset)}
                  readOnly={readOnly}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </div>
      {!readOnly && (
        <div className="border-t border-line-subtle p-3">
          <Button variant="outline" className="w-full" onClick={onAdd} data-testid="studio-add-section">
            <Plus size={16} aria-hidden="true" /> Add section
          </Button>
        </div>
      )}
    </div>
  );
}

function summaryOf(section: StudioSection) {
  const c = section.config as Record<string, unknown>;
  const text = [c.heading, c.headline, c.title, c.titleTemplate, c.eyebrow].find((v) => typeof v === "string" && v.trim());
  return (text as string | undefined) ?? SECTION_META[section.type].description;
}

/** Sections that appear only in some situations, and what that situation is. */
const CONDITIONAL: Partial<Record<StudioSection["type"], string>> = {
  PERSONALIZED_LEAD: "Appears for returning visitors",
  FLASH_SALE: "Appears while a flash sale runs",
  SMART_RECOMMENDATIONS: "Appears once a visitor has browsed",
  TESTIMONIALS: "Appears once you have approved reviews",
};

function absentReason(section: StudioSection, deviceLabel: string) {
  const showOn = (section.config.appearance as { showOn?: string } | undefined)?.showOn;
  if (showOn === "desktop" || showOn === "mobile") return `Hidden on ${deviceLabel}`;
  return CONDITIONAL[section.type] ?? "Nothing to show yet — add content";
}

function scheduleBadge(section: StudioSection) {
  const now = Date.now();
  if (section.startsAt && new Date(section.startsAt).getTime() > now) return { label: "Scheduled", variant: "info" as const };
  if (section.endsAt && new Date(section.endsAt).getTime() < now) return { label: "Ended", variant: "neutral" as const };
  if (section.endsAt) return { label: "Until " + new Date(section.endsAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }), variant: "info" as const };
  return null;
}

function OutlineRow({
  section,
  selected,
  checks,
  hiddenHere,
  deviceLabel,
  onSelect,
  onToggle,
  onMoveBy,
  readOnly,
}: {
  section: StudioSection;
  selected: boolean;
  checks: StudioCheck[];
  hiddenHere: boolean;
  deviceLabel: string;
  onSelect: () => void;
  onToggle: () => void;
  onMoveBy: (offset: -1 | 1) => void;
  readOnly: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id, disabled: readOnly });
  const meta = SECTION_META[section.type];
  const Icon = meta.icon;
  const schedule = scheduleBadge(section);
  const level = checks.some((c) => c.level === "error") ? "error" : checks.some((c) => c.level === "warning") ? "warning" : null;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-1 rounded-xl pr-1 transition-colors duration-fast",
        selected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-ink-900/[0.04]",
        isDragging && "z-raised bg-surface shadow-float",
      )}
      data-testid={`outline-row-${section.type}`}
    >
      {!readOnly && (
        <button
          type="button"
          className="flex h-10 w-6 shrink-0 cursor-grab touch-none [@media(pointer:coarse)]:h-12 [@media(pointer:coarse)]:w-9 items-center justify-center text-fg-subtle opacity-60 hover:opacity-100 active:cursor-grabbing"
          aria-label={`Reorder ${meta.label}`}
          onKeyDown={(e) => {
            // A keyboard alternative to dragging that doesn't need dnd-kit's pick-up mode.
            if (e.altKey && e.key === "ArrowUp") onMoveBy(-1);
            if (e.altKey && e.key === "ArrowDown") onMoveBy(1);
          }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn("flex min-h-12 min-w-0 flex-1 items-center gap-2.5 py-2 text-left", readOnly && "pl-3", !section.isActive && "opacity-55")}
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
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-fg">{meta.label}</span>
            {!section.isActive && (
              <Badge variant="neutral" className="shrink-0">
                Off
              </Badge>
            )}
            {section.isActive && schedule && (
              <Badge variant={schedule.variant} className="shrink-0">
                {schedule.label}
              </Badge>
            )}
          </span>
          {/* Why a switched-on section isn't on the preview right now — said on its own line so the name stays readable. */}
          {hiddenHere ? (
            <span className="block truncate text-xs text-fg-subtle">{absentReason(section, deviceLabel)}</span>
          ) : (
            <span className="block truncate text-xs text-fg-muted">{summaryOf(section)}</span>
          )}
        </span>
      </button>
      {!readOnly && (
        <IconButton
          size="sm"
          aria-label={section.isActive ? `Switch off ${meta.label}` : `Switch on ${meta.label}`}
          aria-pressed={!section.isActive}
          onClick={onToggle}
          // Touch screens have no hover: the switch is always there.
          className={cn(section.isActive && "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100", selected && "opacity-100")}
        >
          {section.isActive ? <Eye size={15} /> : <EyeOff size={15} />}
        </IconButton>
      )}
    </li>
  );
}
