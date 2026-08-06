"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { VariantSelector } from "./variant-selector";
import { CountdownTimer } from "./countdown-timer";
import { useQuickViewStore } from "@/store/quick-view";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

export function QuickViewModal() {
  const product = useQuickViewStore((s) => s.product);
  const close = useQuickViewStore((s) => s.close);
  const [activeImage, setActiveImage] = useState(0);

  if (!product) return null;

  const images = product.images;
  const current = images[activeImage] ?? images[0];

  return (
    <Modal open={Boolean(product)} onClose={close} title={product.name} widthClassName="max-w-3xl">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <div className="relative aspect-square overflow-hidden rounded-lg bg-ink-100">
            {current && (
              <Image
                src={resolveImageUrl(current.url)}
                alt={current.altText ?? product.name}
                fill
                sizes="(min-width: 640px) 40vw, 90vw"
                className="object-cover"
              />
            )}
          </div>
          {images.length > 1 && (
            <div className="mt-2 flex gap-2">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  onClick={() => setActiveImage(i)}
                  className={cn(
                    "relative h-14 w-14 shrink-0 overflow-hidden rounded-md border-2",
                    i === activeImage ? "border-brass-400" : "border-transparent",
                  )}
                >
                  <Image src={resolveImageUrl(img.url)} alt="" fill sizes="56px" className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-ink-400">{product.brandTier}</p>
          <h3 className="mt-1 font-display text-xl text-ink-900">{product.name}</h3>
          <div className="mt-2 flex items-center gap-3">
            {product.activeFlashSale ? (
              <>
                <span className="text-lg text-danger-600">{formatPrice(product.activeFlashSale.flashPrice)}</span>
                <span className="text-sm text-ink-400 line-through">{formatPrice(product.basePrice)}</span>
              </>
            ) : (
              <>
                <span className="text-lg text-ink-900">{formatPrice(product.basePrice)}</span>
                {product.compareAtPrice && (
                  <span className="text-sm text-ink-400 line-through">{formatPrice(product.compareAtPrice)}</span>
                )}
              </>
            )}
          </div>
          {product.activeFlashSale && (
            <p className="mt-1 text-xs uppercase tracking-wide text-danger-600">
              Ends in <CountdownTimer endsAt={product.activeFlashSale.endsAt} className="font-medium" />
            </p>
          )}

          <div className="mt-5">
            <VariantSelector
              variants={product.variants}
              productId={product.id}
              productSlug={product.slug}
              productName={product.name}
              imageUrl={images[0]?.url ?? null}
              basePrice={product.activeFlashSale?.flashPrice ?? product.basePrice}
              lowStockThreshold={product.lowStockThreshold}
              restockDate={product.restockDate}
            />
          </div>

          <Link
            href={`/product/${product.slug}`}
            onClick={close}
            className="mt-4 inline-block text-xs uppercase tracking-wide text-ink-500 underline hover:text-brass-600"
          >
            View full details
          </Link>
        </div>
      </div>
    </Modal>
  );
}
