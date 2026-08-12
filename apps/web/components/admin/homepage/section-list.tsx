"use client";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { REPEATABLE_SECTION_TYPES, type HomepageSection } from "@clothing-brand/shared";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SECTION_META } from "./section-meta";

interface SectionListProps {
  sections: HomepageSection[];
  onReorder: (ids: string[]) => void;
  onToggle: (section: HomepageSection, isActive: boolean) => void;
  onEdit: (section: HomepageSection) => void;
  onDelete: (section: HomepageSection) => void;
}

export function SectionList({ sections, onReorder, onToggle, onEdit, onDelete }: SectionListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = sections.map((s) => s.id);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    // Explicit id: dnd-kit auto-generates aria-describedby ids from a render-order counter when
    // none is given, which drifts between the server render and the client hydration pass in
    // Next.js and throws a "Prop did not match" warning — a fixed id avoids that.
    <DndContext id="homepage-section-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {sections.map((section) => (
            <SortableRow key={section.id} section={section} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface RowProps {
  section: HomepageSection;
  onToggle: SectionListProps["onToggle"];
  onEdit: SectionListProps["onEdit"];
  onDelete: SectionListProps["onDelete"];
}

function SortableRow({ section, onToggle, onEdit, onDelete }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const meta = SECTION_META[section.type];
  const Icon = meta.icon;
  const isRepeatable = REPEATABLE_SECTION_TYPES.includes(section.type);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-ink-100 bg-cream-50 px-3 py-3 transition-opacity",
        isDragging && "z-10 shadow-float ring-2 ring-brass-300",
        !section.isActive && "opacity-60",
      )}
    >
      <button
        type="button"
        className="touch-none text-ink-300 hover:text-ink-600 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={18} />
      </button>
      <Icon size={18} className="shrink-0 text-brass-500" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-900">{meta.label}</p>
        <p className="truncate text-xs text-ink-500">{meta.description}</p>
      </div>
      <Switch
        checked={section.isActive}
        onChange={(isActive) => onToggle(section, isActive)}
        aria-label={`${meta.label} active`}
      />
      {meta.editable && (
        <button
          type="button"
          onClick={() => onEdit(section)}
          className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900"
          aria-label="Edit section"
        >
          <Pencil size={15} />
        </button>
      )}
      {isRepeatable && (
        <button
          type="button"
          onClick={() => onDelete(section)}
          className="rounded p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600"
          aria-label="Delete section"
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}
