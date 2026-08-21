"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import type { Banner, CreateBannerInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/admin/page-header";
import { ContentSubNav } from "@/components/admin/content-subnav";
import { BannerForm } from "@/components/admin/banner-form";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import * as bannersApi from "@/lib/api/admin-banners";
import { ApiError } from "@/lib/api-client";
import { scheduleStatus } from "@/lib/datetime-local";
import { cn } from "@/lib/utils";

export default function BannersPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-banners"], queryFn: bannersApi.listBanners });
  const [formOpen, setFormOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
  }

  const createMutation = useMutation({ mutationFn: bannersApi.createBanner, onSuccess: invalidate });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateBannerInput }) => bannersApi.updateBanner(id, input),
    onSuccess: invalidate,
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => bannersApi.updateBanner(id, { isActive }),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: bannersApi.deleteBanner,
    onSuccess: () => {
      invalidate();
      toast.success("Banner deleted");
    },
  });
  const reorderMutation = useMutation({
    mutationFn: bannersApi.reorderBanners,
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't save the new order"),
  });

  const banners = data?.banners ?? [];

  function openCreate() {
    setEditingBanner(null);
    setFormOpen(true);
  }

  function openEdit(banner: Banner) {
    setEditingBanner(banner);
    setFormOpen(true);
  }

  async function handleFormSubmit(values: CreateBannerInput) {
    if (editingBanner) {
      await updateMutation.mutateAsync({ id: editingBanner.id, input: values });
    } else {
      await createMutation.mutateAsync(values);
    }
    setFormOpen(false);
  }

  async function handleDelete(banner: Banner) {
    if (!(await confirm("Delete this banner?"))) return;
    await deleteMutation.mutateAsync(banner.id);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = banners.map((b) => b.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    reorderMutation.mutate(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <div>
      <PageHeader
        title="Homepage Banners"
        action={
          <Button variant="brass" onClick={openCreate}>
            <Plus size={16} /> Add banner
          </Button>
        }
      />

      <ContentSubNav />

      {isLoading && <p className="text-ink-400">Loading…</p>}
      {!isLoading && banners.length === 0 && (
        <p className="text-ink-400">No banners yet — the homepage hero uses a default layout until you add one.</p>
      )}
      {!isLoading && banners.length > 0 && (
        <DndContext id="banners-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={banners.map((b) => b.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {banners.map((b) => (
                <SortableBannerCard
                  key={b.id}
                  banner={b}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onToggle={(isActive) => toggleMutation.mutate({ id: b.id, isActive })}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editingBanner ? "Edit banner" : "Add banner"}>
        <BannerForm
          banner={editingBanner}
          submitLabel={editingBanner ? "Save changes" : "Add banner"}
          onSubmit={handleFormSubmit}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>
      {confirmDialog}
    </div>
  );
}

function SortableBannerCard({
  banner,
  onEdit,
  onDelete,
  onToggle,
}: {
  banner: Banner;
  onEdit: (banner: Banner) => void;
  onDelete: (banner: Banner) => void;
  onToggle: (isActive: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: banner.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const status = scheduleStatus(banner);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "overflow-hidden rounded-lg border border-ink-100 bg-cream-50 transition-opacity",
        isDragging && "z-10 shadow-float ring-2 ring-brass-300",
        !banner.isActive && "opacity-70",
      )}
    >
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={banner.imageUrl} alt={banner.altText ?? banner.title ?? ""} className="h-36 w-full object-cover" />
        <button
          type="button"
          className="absolute left-2 top-2 touch-none rounded-full bg-ink-900/60 p-1.5 text-cream-50 active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
      </div>
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Badge>{banner.placement === "HERO_CAROUSEL" ? "Hero" : "Promo strip"}</Badge>
            {status && <Badge className={status.className}>{status.label}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onEdit(banner)} className="text-ink-400 hover:text-ink-900" aria-label="Edit">
              <Pencil size={14} />
            </button>
            <button onClick={() => onDelete(banner)} className="text-ink-400 hover:text-danger-600" aria-label="Delete">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        {banner.title && <p className="text-sm font-medium text-ink-900">{banner.title}</p>}
        {banner.subtitle && <p className="text-xs text-ink-500">{banner.subtitle}</p>}
        <label className="mt-3 flex items-center gap-2 text-xs text-ink-600">
          <Checkbox checked={banner.isActive} onChange={(e) => onToggle(e.target.checked)} />
          Active
        </label>
      </div>
    </div>
  );
}
