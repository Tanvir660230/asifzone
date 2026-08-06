"use client";

import { useRef, useState, type DragEvent } from "react";
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
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, Upload, Sparkles, Star, GripVertical } from "lucide-react";
import type { ProductImage } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveImageUrl } from "@/lib/image-url";
import * as productsApi from "@/lib/api/products";
import * as aiApi from "@/lib/api/ai";
import { ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

export interface StagedImage {
  key: string;
  file: File;
  previewUrl: string;
}

interface ImageUploaderProps {
  /** Omit while creating a new product (no id yet) — the uploader switches to staged mode:
   * files are held in memory until the caller uploads them once the product exists. */
  productId?: string;
  images?: ProductImage[];
  staged?: StagedImage[];
  onStagedChange?: (next: StagedImage[]) => void;
}

function filesToStaged(files: File[]): StagedImage[] {
  return files.map((file) => ({
    key: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${file.name}-${Date.now()}-${Math.random()}`,
    file,
    previewUrl: URL.createObjectURL(file),
  }));
}

export function ImageUploader({ productId, images = [], staged = [], onStagedChange }: ImageUploaderProps) {
  const staticMode = !productId;
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data: aiStatus } = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.getAiStatus });
  const { data: currentAdmin } = useCurrentAdmin();
  const canUseAi = aiStatus?.configured && currentAdmin?.admin.role === "OWNER";

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => productsApi.uploadProductImages(productId!, files),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", productId] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => productsApi.deleteProductImage(productId!, imageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", productId] }),
  });
  const altTextMutation = useMutation({
    mutationFn: ({ imageId, altText }: { imageId: string; altText: string }) =>
      productsApi.updateProductImageAltText(productId!, imageId, altText),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", productId] }),
  });
  const reorderMutation = useMutation({
    mutationFn: (imageIds: string[]) => productsApi.reorderProductImages(productId!, imageIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", productId] }),
  });

  function altValue(img: ProductImage) {
    return altDrafts[img.id] ?? img.altText ?? "";
  }

  async function handleGenerateAlt(img: ProductImage) {
    setGeneratingId(img.id);
    try {
      const { text } = await aiApi.generateImageAltText(img.url);
      setAltDrafts((d) => ({ ...d, [img.id]: text }));
      await altTextMutation.mutateAsync({ imageId: img.id, altText: text });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't generate alt text");
    } finally {
      setGeneratingId(null);
    }
  }

  async function handleFilesSelected(fileList: FileList | File[] | null) {
    const files = fileList ? Array.from(fileList) : [];
    if (!files.length) return;
    setError(null);

    if (staticMode) {
      onStagedChange?.([...staged, ...filesToStaged(files)]);
      return;
    }

    try {
      await uploadMutation.mutateAsync(files);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDraggingFiles(false);
    handleFilesSelected(e.dataTransfer.files);
  }

  function removeStaged(key: string) {
    const target = staged.find((s) => s.key === key);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onStagedChange?.(staged.filter((s) => s.key !== key));
  }

  function setMain(index: number) {
    if (staticMode) {
      onStagedChange?.(arrayMove(staged, index, 0));
    } else {
      const ids = images.map((img) => img.id);
      reorderMutation.mutate(arrayMove(ids, index, 0));
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    if (staticMode) {
      const oldIndex = staged.findIndex((s) => s.key === active.id);
      const newIndex = staged.findIndex((s) => s.key === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      onStagedChange?.(arrayMove(staged, oldIndex, newIndex));
    } else {
      const ids = images.map((img) => img.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      reorderMutation.mutate(arrayMove(ids, oldIndex, newIndex));
    }
  }

  const sortableIds = staticMode ? staged.map((s) => s.key) : images.map((img) => img.id);
  const count = sortableIds.length;

  return (
    <div>
      <div
        className={cn(
          "mb-3 grid grid-cols-2 gap-3 rounded-lg border-2 border-dashed p-2 transition-colors sm:grid-cols-4",
          isDraggingFiles ? "border-brass-400 bg-brass-50/40" : "border-transparent",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingFiles(true);
        }}
        onDragLeave={() => setIsDraggingFiles(false)}
        onDrop={handleDrop}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            {staticMode
              ? staged.map((item, index) => (
                  <SortableThumb key={item.key} id={item.key} isMain={index === 0} onSetMain={() => setMain(index)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                    <button
                      onClick={() => removeStaged(item.key)}
                      className="absolute right-1 top-1 rounded-full bg-ink-900/70 p-1 text-cream-50 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Remove image"
                    >
                      <X size={14} />
                    </button>
                  </SortableThumb>
                ))
              : images.map((img, index) => (
                  <div key={img.id} className="space-y-1">
                    <SortableThumb id={img.id} isMain={index === 0} onSetMain={() => setMain(index)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={resolveImageUrl(img.url)}
                        alt={img.altText ?? ""}
                        className="h-full w-full object-cover"
                      />
                      <button
                        onClick={() => deleteMutation.mutate(img.id)}
                        className="absolute right-1 top-1 rounded-full bg-ink-900/70 p-1 text-cream-50 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label="Remove image"
                      >
                        <X size={14} />
                      </button>
                    </SortableThumb>
                    <div className="flex items-center gap-1">
                      <Input
                        value={altValue(img)}
                        placeholder="Alt text"
                        className="h-7 text-xs"
                        onChange={(e) => setAltDrafts((d) => ({ ...d, [img.id]: e.target.value }))}
                        onBlur={() => {
                          const value = altValue(img);
                          if (value !== (img.altText ?? "")) altTextMutation.mutate({ imageId: img.id, altText: value });
                        }}
                      />
                      {canUseAi && (
                        <button
                          type="button"
                          onClick={() => handleGenerateAlt(img)}
                          disabled={generatingId === img.id}
                          aria-label="Generate alt text with AI"
                          className="shrink-0 rounded p-1 text-brass-600 hover:bg-brass-50 disabled:opacity-50"
                        >
                          <Sparkles size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
          </SortableContext>
        </DndContext>

        {count === 0 && (
          <div className="col-span-2 flex aspect-square items-center justify-center rounded border border-dashed border-ink-200 text-center text-xs text-ink-400 sm:col-span-4 sm:aspect-[4/1]">
            Drag &amp; drop images here, or use the button below
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        className="hidden"
        onChange={(e) => handleFilesSelected(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={!staticMode && uploadMutation.isPending}
      >
        <Upload size={14} /> {!staticMode && uploadMutation.isPending ? "Uploading…" : "Upload images"}
      </Button>
      {error && <p className="mt-2 text-xs text-danger-600">{error}</p>}
    </div>
  );
}

interface SortableThumbProps {
  id: string;
  isMain: boolean;
  onSetMain: () => void;
  children: React.ReactNode;
}

function SortableThumb({ id, isMain, onSetMain, children }: SortableThumbProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative aspect-square overflow-hidden rounded border border-ink-100",
        isDragging && "z-10 shadow-float ring-2 ring-brass-300",
      )}
    >
      {children}
      <button
        type="button"
        className="absolute left-1 top-1 touch-none rounded-full bg-ink-900/70 p-1 text-cream-50 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      {isMain ? (
        <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-ink-900/80 px-1.5 py-0.5 text-[10px] text-cream-50">
          <Star size={10} className="fill-brass-400 text-brass-400" /> Main
        </span>
      ) : (
        <button
          type="button"
          onClick={onSetMain}
          className="absolute bottom-1 left-1 rounded-full bg-ink-900/70 px-1.5 py-0.5 text-[10px] text-cream-50 opacity-0 transition-opacity group-hover:opacity-100"
        >
          Set main
        </button>
      )}
    </div>
  );
}
