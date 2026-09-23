"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
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
import { X, Upload, Sparkles, Star, GripVertical, RotateCw } from "lucide-react";
import type { ProductImage } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveImageUrl } from "@/lib/image-url";
import * as productsApi from "@/lib/api/products";
import * as aiApi from "@/lib/api/ai";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import { takePendingUploads } from "@/lib/wizard/pending-uploads";
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

/** A file on its way up (live mode): shown in the grid with its progress, or with its error and a Retry. */
interface UploadItem {
  key: string;
  file: File;
  previewUrl: string;
  progress: number;
  status: "queued" | "uploading" | "failed";
  error?: string;
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
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data: aiStatus } = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.getAiStatus });
  const { data: currentAdmin } = useCurrentAdmin();
  const canUseAi = aiStatus?.configured && currentAdmin?.admin.role === "OWNER";

  // Live mode uploads one file per request, one at a time: a bad or failed file only fails itself (and can be
  // retried), and the server appends each image after the last, so going one by one keeps the order they were added.
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const uploadingRef = useRef(false);

  function enqueue(files: File[]) {
    setQueue((q) => [...q, ...filesToStaged(files).map((f) => ({ ...f, progress: 0, status: "queued" as const }))]);
  }

  const patchItem = (key: string, change: Partial<UploadItem>) => setQueue((q) => q.map((i) => (i.key === key ? { ...i, ...change } : i)));

  useEffect(() => {
    if (staticMode || uploadingRef.current) return;
    const next = queue.find((q) => q.status === "queued");
    if (!next) return;
    uploadingRef.current = true;
    patchItem(next.key, { status: "uploading", progress: 0, error: undefined });
    productsApi
      .uploadProductImage(productId!, next.file, (fraction) => patchItem(next.key, { progress: fraction }))
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ["product", productId] });
        URL.revokeObjectURL(next.previewUrl);
        setQueue((q) => q.filter((i) => i.key !== next.key));
      })
      .catch((err) => patchItem(next.key, { status: "failed", error: getErrorMessage(err, "Upload failed") }))
      .finally(() => {
        uploadingRef.current = false;
        setQueue((q) => [...q]); // look for the next queued file
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, staticMode, productId]);

  // Photos staged before this product existed (the new-product wizard hands them over on creation) go up here, through
  // the same queue — so if one fails, it's right here with a Retry, not lost.
  useEffect(() => {
    if (!productId) return;
    const files = takePendingUploads(productId);
    if (files.length) enqueue(files);
  }, [productId]);

  const failedCount = queue.filter((q) => q.status === "failed").length;
  const inFlightCount = queue.length - failedCount;
  const retryItem = (key: string) => patchItem(key, { status: "queued", progress: 0, error: undefined });
  const retryAllFailed = () => setQueue((q) => q.map((i) => (i.status === "failed" ? { ...i, status: "queued", progress: 0, error: undefined } : i)));
  function discardItem(key: string) {
    const item = queue.find((i) => i.key === key);
    if (item) URL.revokeObjectURL(item.previewUrl);
    setQueue((q) => q.filter((i) => i.key !== key));
  }
  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => productsApi.deleteProductImage(productId!, imageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", productId] }),
  });
  const altTextMutation = useMutation({
    mutationFn: ({ imageId, altText }: { imageId: string; altText: string }) =>
      productsApi.updateProductImageAltText(productId!, imageId, altText),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", productId] }),
  });
  const captionMutation = useMutation({
    mutationFn: ({ imageId, caption }: { imageId: string; caption: string }) => productsApi.updateProductImage(productId!, imageId, { caption }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", productId] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't save the caption"),
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

    enqueue(files);
    if (inputRef.current) inputRef.current.value = "";
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
  const count = sortableIds.length + (staticMode ? 0 : queue.length);

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
        {/* Explicit id: dnd-kit auto-generates aria-describedby ids from a render-order counter
            when none is given, which drifts between the server render and the client hydration
            pass in Next.js and throws a "Prop did not match" warning — a fixed id avoids that. */}
        <DndContext id="image-uploader-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
                    <Input
                      value={captionDrafts[img.id] ?? img.caption ?? ""}
                      placeholder="Caption (optional)"
                      aria-label="Image caption"
                      className="h-7 text-xs"
                      onChange={(e) => setCaptionDrafts((d) => ({ ...d, [img.id]: e.target.value }))}
                      onBlur={() => {
                        const value = captionDrafts[img.id] ?? img.caption ?? "";
                        if (value !== (img.caption ?? "")) captionMutation.mutate({ imageId: img.id, caption: value });
                      }}
                    />
                    {img.width && img.height && (
                      <p className="text-[10px] text-ink-400">
                        {img.width}×{img.height}px
                      </p>
                    )}
                  </div>
                ))}
          </SortableContext>
        </DndContext>

        {!staticMode &&
          queue.map((item) => (
            <div key={item.key} className="relative aspect-square overflow-hidden rounded border border-ink-100" data-testid="upload-item" data-status={item.status}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.previewUrl} alt="" className={cn("h-full w-full object-cover", item.status !== "failed" && "opacity-50")} />
              {item.status === "failed" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-cream-50/90 p-2 text-center" role="alert">
                  <p className="text-[11px] font-medium text-danger-700">Couldn&rsquo;t upload {item.file.name}</p>
                  <p className="line-clamp-2 text-[10px] text-ink-500">{item.error}</p>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => retryItem(item.key)}>
                      <RotateCw size={12} /> Retry
                    </Button>
                    <button type="button" onClick={() => discardItem(item.key)} className="text-[11px] text-ink-500 underline hover:text-ink-900">
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-x-2 bottom-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink-900/20" role="progressbar" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${item.file.name}`}>
                    <div className="h-full rounded-full bg-ink-900 transition-all duration-150" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-center text-[10px] font-medium text-ink-900">{item.status === "queued" ? "Waiting…" : `${Math.round(item.progress * 100)}%`}</p>
                </div>
              )}
            </div>
          ))}

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
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <Upload size={14} /> Upload images
        </Button>
        {inFlightCount > 0 && (
          <span className="text-xs text-ink-500" role="status" data-testid="upload-status">
            Uploading {inFlightCount} image{inFlightCount === 1 ? "" : "s"}…
          </span>
        )}
        {failedCount > 0 && (
          <span className="flex items-center gap-2 text-xs text-danger-700" data-testid="upload-failed-summary">
            {failedCount} failed
            {failedCount > 1 && (
              <button type="button" onClick={retryAllFailed} className="underline hover:text-danger-900">
                Retry all
              </button>
            )}
          </span>
        )}
      </div>
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
