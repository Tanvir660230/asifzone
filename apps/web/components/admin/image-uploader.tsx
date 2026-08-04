"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Upload } from "lucide-react";
import type { ProductImage } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import * as productsApi from "@/lib/api/products";
import { ApiError } from "@/lib/api-client";

interface ImageUploaderProps {
  productId: string;
  images: ProductImage[];
}

export function ImageUploader({ productId, images }: ImageUploaderProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => productsApi.uploadProductImages(productId, files),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", productId] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => productsApi.deleteProductImage(productId, imageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product", productId] }),
  });

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
          <div key={img.id} className="group relative aspect-square overflow-hidden rounded border border-ink-100">
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
