"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Upload } from "lucide-react";
import { createBannerSchema, type Banner, type CreateBannerInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/admin/page-header";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import * as bannersApi from "@/lib/api/admin-banners";
import { ApiError } from "@/lib/api-client";

export default function BannersPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-banners"], queryFn: bannersApi.listBanners });
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileFileInputRef = useRef<HTMLInputElement>(null);

  const createMutation = useMutation({
    mutationFn: bannersApi.createBanner,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-banners"] }),
  });
  const uploadMutation = useMutation({ mutationFn: bannersApi.uploadBannerImage });
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => bannersApi.updateBanner(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-banners"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: bannersApi.deleteBanner,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
      toast.success("Banner deleted");
    },
  });
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateBannerInput>({
    resolver: zodResolver(createBannerSchema),
    defaultValues: { placement: "HERO_CAROUSEL", isActive: true, sortOrder: 0, imageUrl: "" },
  });
  const imageUrl = watch("imageUrl");
  const mobileImageUrl = watch("mobileImageUrl");

  async function handleImageSelected(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const { url } = await uploadMutation.mutateAsync(file);
      setValue("imageUrl", url, { shouldValidate: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Image upload failed");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleMobileImageSelected(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const { url } = await uploadMutation.mutateAsync(file);
      setValue("mobileImageUrl", url, { shouldValidate: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Image upload failed");
    } finally {
      if (mobileFileInputRef.current) mobileFileInputRef.current.value = "";
    }
  }

  async function onSubmit(values: CreateBannerInput) {
    setError(null);
    try {
      await createMutation.mutateAsync(values);
      setShowCreate(false);
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create banner");
    }
  }

  async function handleDelete(banner: Banner) {
    if (!(await confirm("Delete this banner?"))) return;
    await deleteMutation.mutateAsync(banner.id);
  }

  return (
    <div>
      <PageHeader
        title="Homepage Banners"
        action={
          <Button variant="brass" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Add banner
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && <p className="text-ink-400">Loading…</p>}
        {!isLoading && data?.banners.length === 0 && <p className="text-ink-400">No banners yet — the homepage hero uses a default layout until you add one.</p>}
        {data?.banners.map((b) => (
          <div key={b.id} className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.imageUrl} alt={b.altText ?? b.title ?? ""} className="h-36 w-full object-cover" />
            <div className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <Badge>{b.placement === "HERO_CAROUSEL" ? "Hero" : "Promo strip"}</Badge>
                <button onClick={() => handleDelete(b)} className="text-ink-400 hover:text-danger-600">
                  <Trash2 size={14} />
                </button>
              </div>
              {b.title && <p className="text-sm font-medium text-ink-900">{b.title}</p>}
              {b.subtitle && <p className="text-xs text-ink-500">{b.subtitle}</p>}
              <label className="mt-3 flex items-center gap-2 text-xs text-ink-600">
                <Checkbox
                  checked={b.isActive}
                  onChange={(e) => toggleMutation.mutate({ id: b.id, isActive: e.target.checked })}
                />
                Active
              </label>
            </div>
          </div>
        ))}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add banner">
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label>Banner image</Label>
            <p className="mb-1 text-xs text-ink-400">
              Recommended size: 1920×640px (3:1). The homepage hero is locked to this ratio so the full image —
              including any text baked into it — always shows edge-to-edge with no cropping, at any screen size.
            </p>
            <input type="hidden" {...register("imageUrl")} />
            {imageUrl ? (
              <div className="relative mt-1 h-32 w-full overflow-hidden rounded-lg border border-ink-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setValue("imageUrl", "", { shouldValidate: true })}
                  className="absolute right-2 top-2 rounded-full bg-ink-900/70 p-1 text-cream-50"
                  aria-label="Remove image"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="mt-1 flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-ink-300 text-ink-500 transition-colors hover:border-brass-400 hover:text-brass-500 disabled:opacity-50"
              >
                <Upload size={20} />
                <span className="text-xs">{uploadMutation.isPending ? "Uploading…" : "Click to upload an image"}</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => handleImageSelected(e.target.files?.[0] ?? null)}
            />
            {errors.imageUrl && <p className="mt-1 text-xs text-danger-600">{errors.imageUrl.message}</p>}
          </div>
          <div>
            <Label>Mobile image (optional)</Label>
            <p className="mb-1 text-xs text-ink-400">
              Recommended size: 1254×1254px (square, 1:1) — the hero switches to a square frame below desktop
              width. Without this, phones fall back to a center-crop of the wide image above, which can cut off
              text baked into it. Upload a square crop of the same scene here to avoid that.
            </p>
            <input type="hidden" {...register("mobileImageUrl")} />
            {mobileImageUrl ? (
              <div className="relative mt-1 h-32 w-24 overflow-hidden rounded-lg border border-ink-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mobileImageUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setValue("mobileImageUrl", "", { shouldValidate: true })}
                  className="absolute right-1 top-1 rounded-full bg-ink-900/70 p-1 text-cream-50"
                  aria-label="Remove mobile image"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => mobileFileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="mt-1 flex h-32 w-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-300 text-ink-500 transition-colors hover:border-brass-400 hover:text-brass-500 disabled:opacity-50"
              >
                <Upload size={18} />
                <span className="text-center text-[11px]">{uploadMutation.isPending ? "Uploading…" : "Upload"}</span>
              </button>
            )}
            <input
              ref={mobileFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => handleMobileImageSelected(e.target.files?.[0] ?? null)}
            />
          </div>
          <div>
            <Label htmlFor="placement">Placement</Label>
            <Select id="placement" {...register("placement")}>
              <option value="HERO_CAROUSEL">Homepage hero</option>
              <option value="PROMO_STRIP">Promo strip</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="title">Title (optional)</Label>
              <Input id="title" {...register("title")} />
            </div>
            <div>
              <Label htmlFor="subtitle">Subtitle (optional)</Label>
              <Input id="subtitle" {...register("subtitle")} />
            </div>
          </div>
          <div>
            <Label htmlFor="linkUrl">Link URL (optional)</Label>
            <Input id="linkUrl" placeholder="/category/men" {...register("linkUrl")} />
          </div>
          <div>
            <Label htmlFor="altText">Image alt text (optional)</Label>
            <p className="mb-1 text-xs text-ink-400">
              Describes the image for screen readers and image search — falls back to the title above if left blank.
            </p>
            <Input id="altText" placeholder="Model wearing a navy panjabi against a beige backdrop" {...register("altText")} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brass" disabled={isSubmitting || !imageUrl}>
              {isSubmitting ? "Saving…" : "Add banner"}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
