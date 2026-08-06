"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Upload, Sparkles } from "lucide-react";
import type { ProductImage } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { env } from "@/lib/env";
import * as productsApi from "@/lib/api/products";
import * as aiApi from "@/lib/api/ai";
import { ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

interface ImageUploaderProps {
  productId: string;
  images: ProductImage[];
}

export function ImageUploader({ productId, images }: ImageUploaderProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const { data: aiStatus } = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.getAiStatus });
  const { data: currentAdmin } = useCurrentAdmin();
  const canUseAi = aiStatus?.configured && currentAdmin?.admin.role === "OWNER";

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => productsApi.uploadProductImages(productId, files),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", productId] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => productsApi.deleteProductImage(productId, imageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", productId] }),
  });
  const altTextMutation = useMutation({
    mutationFn: ({ imageId, altText }: { imageId: string; altText: string }) =>
      productsApi.updateProductImageAltText(productId, imageId, altText),
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

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError(null);
    try {
      await uploadMutation.mutateAsync(Array.from(fileList));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {images.map((img) => (
          <div key={img.id} className="space-y-1">
            <div className="group relative aspect-square overflow-hidden rounded border border-ink-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${env.apiUrl}${img.url}`} alt={img.altText ?? ""} className="h-full w-full object-cover" />
              <button
                onClick={() => deleteMutation.mutate(img.id)}
                className="absolute right-1 top-1 rounded-full bg-ink-900/70 p-1 text-cream-50 opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Remove image"
              >
                <X size={14} />
              </button>
            </div>
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
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleFilesSelected(e.target.files)}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploadMutation.isPending}>
        <Upload size={14} /> {uploadMutation.isPending ? "Uploading…" : "Upload images"}
      </Button>
      {error && <p className="mt-2 text-xs text-danger-600">{error}</p>}
    </div>
  );
}
