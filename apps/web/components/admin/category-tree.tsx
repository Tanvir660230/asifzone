"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
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
import { ChevronRight, GripVertical, Pencil, Trash2, FolderPlus, Star, ImageIcon, Package } from "lucide-react";
import type { Category, CategoryStockStat } from "@clothing-brand/shared";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";

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
  /** id -> self+descendant stock rollup, from GET /api/categories/stock-map. Undefined while
   * loading — rows just render without the badge rather than blocking on it. */
  stock?: Record<string, CategoryStockStat>;
  onToggleActive: (category: Category, next: boolean) => void;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  onAddChild: (parentId: string) => void;
  onReorder: (parentId: string | null, orderedIds: string[]) => void;
  onMove: (id: string, newParentId: string, sortOrder: number) => void;
}

/** Nested drag-to-reorder category tree. Dragging a row onto another row (in the same or a
 * different sibling group) reorders it in place; dropping it onto a category's dedicated
 * "child zone" (its own droppable region, shown only while dragging, highlighted on hover)
 * moves it to become that category's child instead — this is how a category is reparented, e.g.
 * moving "Cap" out of "Accessories" and into "Men" by dropping it on Men's child zone. */
export function CategoryTree({ categories, stock, onToggleActive, onEdit, onDelete, onAddChild, onReorder, onMove }: CategoryTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
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

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const overData = over.data.current as { isChildZone?: boolean; parentId: string | null } | undefined;

    if (overData?.isChildZone) {
      if (overData.parentId === active.id) return;
      const destination = byParent.get(overData.parentId) ?? [];
      onMove(active.id as string, overData.parentId as string, destination.length);
      return;
    }

    if (active.id === over.id) return;

    const activeParent = (active.data.current as { parentId: string | null } | undefined)?.parentId ?? null;
    const overParent = overData?.parentId ?? null;
    const group = byParent.get(overParent) ?? [];
    const newIndex = group.findIndex((c) => c.id === over.id);

    if (activeParent === overParent) {
      const oldIndex = group.findIndex((c) => c.id === active.id);
      if (oldIndex === -1 || newIndex === -1) return;
      onReorder(activeParent, arrayMove(group, oldIndex, newIndex).map((c) => c.id));
    } else if (overParent) {
      onMove(active.id as string, overParent, newIndex === -1 ? group.length : newIndex);
    }
  }

  if (categories.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-cream-50 px-6 py-12 text-center text-ink-400">
        No categories yet — add your first one.
      </div>
    );
  }

  return (
    // Explicit id: dnd-kit auto-generates aria-describedby ids from a render-order counter when
    // none is given, which drifts between the server render and the client hydration pass in
    // Next.js and throws a "Prop did not match" warning — a fixed id makes it deterministic.
    <DndContext id="category-tree-dnd" sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-2">
        <SortableContext items={topLevel.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {topLevel.map((cat) => (
            <CategoryNode
              key={cat.id}
              category={cat}
              depth={0}
              byParent={byParent}
              stock={stock}
              expanded={expanded}
              activeId={activeId}
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

/** Droppable "move into this category" target — a distinct id/region from the category's own
 * sortable row, so hovering the row itself still means "reorder among siblings" while hovering
 * this strip means "reparent here." Only rendered while a drag is in progress. */
function ChildDropZone({ category, activeId }: { category: Category; activeId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `childzone:${category.id}`,
    data: { isChildZone: true, parentId: category.id },
  });

  if (!activeId || activeId === category.id) return null;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "ml-6 mt-2 rounded-lg border border-dashed px-3 py-2 text-center text-xs transition-colors duration-150 ease-smooth",
        isOver ? "border-brass-400 bg-brass-50 text-brass-700" : "border-ink-200 text-ink-400",
      )}
    >
      Drop here to move into {category.name}
    </div>
  );
}

interface CategoryNodeProps {
  category: Category;
  depth: number;
  byParent: ByParent;
  stock?: Record<string, CategoryStockStat>;
  expanded: Set<string>;
  activeId: string | null;
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
  stock,
  expanded,
  activeId,
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
          "group flex flex-wrap items-center gap-2 rounded-xl border transition-all duration-200 ease-smooth sm:flex-nowrap",
          isMain
            ? "border-ink-100 bg-cream-50 px-4 py-3 shadow-sm hover:shadow-float"
            : "border-ink-100/70 bg-cream-100/50 px-3 py-2 hover:bg-cream-100",
          isDragging && "shadow-float ring-2 ring-brass-300",
        )}
      >
        {/* Identity cluster: drag handle, expand chevron, thumbnail, name/slug — always its own row,
            full-width below sm so a long name has room instead of fighting the action buttons for space. */}
        <button
          type="button"
          // Hover-revealed only once there's room for a mouse-driven row (sm+); a touch device below
          // that has no hover at all, so the handle needs to just be visible to be reachable.
          className="cursor-grab touch-none rounded p-1 text-ink-300 opacity-100 transition-opacity duration-150 ease-smooth active:cursor-grabbing sm:opacity-0 sm:group-hover:opacity-100"
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
            {stock?.[category.id] && (
              <Badge
                variant={stock[category.id]!.totalStock > 0 ? "success" : "neutral"}
                className={cn(
                  "gap-1 border-0 tabular-nums",
                  stock[category.id]!.totalStock === 0 && "bg-ink-50 text-ink-300",
                )}
                title={`${stock[category.id]!.inStockProducts} of ${stock[category.id]!.totalProducts} products in stock, including subcategories`}
              >
                <Package size={10} />
                {stock[category.id]!.totalStock} in stock
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-ink-400">/{category.slug}</p>
        </div>

        {/* Action cluster: below sm this drops to its own full-width, right-aligned row instead of
            squeezing five controls onto the same line as the name — matches the table/card-style
            responsive split already used on the Orders admin page. */}
        <div className="ml-8 flex w-full items-center justify-end gap-1 sm:ml-0 sm:w-auto">
          <button
            type="button"
            onClick={() => onAddChild(category.id)}
            className={cn(
              ICON_BUTTON_HIT,
              "rounded-full text-ink-400 opacity-100 hover:text-ink-700 sm:opacity-0 sm:group-hover:opacity-100",
            )}
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

          {/* Wider gap than the outer row's default — ICON_BUTTON_HIT's -m-2 gives each button an
              extra ~8px of invisible hit area per side, which a tighter gap here would let overlap
              between these two adjacent buttons specifically. */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onEdit(category)}
              className={cn(ICON_BUTTON_HIT, "rounded-full text-ink-400 hover:text-ink-900")}
              aria-label={`Edit ${category.name}`}
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(category)}
              className={cn(ICON_BUTTON_HIT, "rounded-full text-ink-400 hover:text-danger-600")}
              aria-label={`Delete ${category.name}`}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </div>

      <ChildDropZone category={category} activeId={activeId} />

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
                    stock={stock}
                    expanded={expanded}
                    activeId={activeId}
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
