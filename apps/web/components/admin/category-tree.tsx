"use client";

import { useState } from "react";
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
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, GripVertical, Pencil, Trash2, FolderPlus, Star, ImageIcon } from "lucide-react";
import type { Category } from "@clothing-brand/shared";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ByParent = Map<string | null, Category[]>;

function groupByParent(categories: Category[]): ByParent {
  const map: ByParent = new Map();
  for (const c of categories) {
    const key = c.parentId;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  for (const group of map.values()) {
    group.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  return map;
}

interface CategoryTreeProps {
  categories: Category[];
  onToggleActive: (category: Category, next: boolean) => void;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  onAddChild: (parentId: string) => void;
  onReorder: (parentId: string | null, orderedIds: string[]) => void;
}

/** Nested drag-to-reorder category tree. Dragging is scoped to one sibling group at a time —
 * dropping a category onto a row from a different parent is a no-op rather than a silent
 * reparent, since reparenting is a deliberate action that already lives in the edit form (which
 * guards against creating a cycle). */
export function CategoryTree({ categories, onToggleActive, onEdit, onDelete, onAddChild, onReorder }: CategoryTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(categories.filter((c) => !c.parentId).map((c) => c.id)),
  );
  const byParent = groupByParent(categories);
  const topLevel = byParent.get(null) ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeParent = (active.data.current as { parentId: string | null } | undefined)?.parentId ?? null;
    const overParent = (over.data.current as { parentId: string | null } | undefined)?.parentId ?? null;
    if (activeParent !== overParent) return;

    const group = byParent.get(activeParent) ?? [];
    const oldIndex = group.findIndex((c) => c.id === active.id);
    const newIndex = group.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    onReorder(activeParent, arrayMove(group, oldIndex, newIndex).map((c) => c.id));
  }

  if (categories.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-cream-50 px-6 py-12 text-center text-ink-400">
        No categories yet — add your first one.
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="space-y-2">
        <SortableContext items={topLevel.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {topLevel.map((cat) => (
            <CategoryNode
              key={cat.id}
              category={cat}
              depth={0}
              byParent={byParent}
              expanded={expanded}
              onToggleExpanded={toggleExpanded}
              onToggleActive={onToggleActive}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </SortableContext>
      </div>
    </DndContext>
  );
}

interface CategoryNodeProps {
  category: Category;
  depth: number;
  byParent: ByParent;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  onToggleActive: (category: Category, next: boolean) => void;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  onAddChild: (parentId: string) => void;
}

function CategoryNode({
  category,
  depth,
  byParent,
  expanded,
  onToggleExpanded,
  onToggleActive,
  onEdit,
  onDelete,
  onAddChild,
}: CategoryNodeProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    data: { parentId: category.parentId },
  });

  const children = byParent.get(category.id) ?? [];
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(category.id);
  const isMain = depth === 0;

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-xl border transition-all duration-200 ease-smooth",
          isMain
            ? "border-ink-100 bg-cream-50 px-4 py-3 shadow-sm hover:shadow-float"
            : "border-ink-100/70 bg-cream-100/50 px-3 py-2 hover:bg-cream-100",
          isDragging && "shadow-float ring-2 ring-brass-300",
        )}
      >
        <button
          type="button"
          className="cursor-grab touch-none rounded p-1 text-ink-300 opacity-0 transition-opacity duration-150 ease-smooth group-hover:opacity-100 active:cursor-grabbing"
          aria-label={`Drag to reorder ${category.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>

        <button
          type="button"
          onClick={() => hasChildren && onToggleExpanded(category.id)}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400 transition-transform duration-200 ease-smooth",
            hasChildren ? "hover:bg-ink-100 hover:text-ink-700" : "invisible",
            isOpen && "rotate-90",
          )}
          aria-label={isOpen ? `Collapse ${category.name}` : `Expand ${category.name}`}
        >
          <ChevronRight size={16} />
        </button>

        <div
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-50",
            isMain ? "h-10 w-10" : "h-8 w-8",
          )}
        >
          {category.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={category.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon size={isMain ? 18 : 14} className="text-ink-300" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "truncate",
                isMain ? "font-display text-base text-ink-900" : "text-sm font-medium text-ink-800",
              )}
            >
              {category.name}
            </span>
            {category.isFeatured && (
              <Badge className="gap-1 border-0 bg-brass-100 text-brass-700">
                <Star size={10} className="fill-current" /> Featured
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-ink-400">/{category.slug}</p>
        </div>

        <button
          type="button"
          onClick={() => onAddChild(category.id)}
          className="rounded-full p-1.5 text-ink-400 opacity-0 transition-opacity duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-700 group-hover:opacity-100"
          aria-label={`Add sub-category under ${category.name}`}
          title="Add sub-category"
        >
          <FolderPlus size={16} />
        </button>

        <Switch
          checked={category.isActive}
          onChange={(next) => onToggleActive(category, next)}
          aria-label={category.isActive ? `Deactivate ${category.name}` : `Activate ${category.name}`}
        />

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(category)}
            className="rounded-full p-1.5 text-ink-400 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-900"
            aria-label={`Edit ${category.name}`}
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(category)}
            className="rounded-full p-1.5 text-ink-400 transition-colors duration-150 ease-smooth hover:bg-danger-50 hover:text-danger-600"
            aria-label={`Delete ${category.name}`}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {hasChildren && isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="ml-6 mt-2 space-y-2 border-l border-dashed border-ink-200 pl-4">
              <SortableContext items={children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {children.map((child) => (
                  <CategoryNode
                    key={child.id}
                    category={child}
                    depth={depth + 1}
                    byParent={byParent}
                    expanded={expanded}
                    onToggleExpanded={onToggleExpanded}
                    onToggleActive={onToggleActive}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onAddChild={onAddChild}
                  />
                ))}
              </SortableContext>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
