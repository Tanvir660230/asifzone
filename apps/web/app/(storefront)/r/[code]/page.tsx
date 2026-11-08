"use client";

import { use, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StorefrontPage, StorefrontPageHeader } from "@/components/storefront/storefront-page";
import { ApiError } from "@/lib/api-client";
import { getReviewLink, submitReviewLink, type ReviewLinkView } from "@/lib/api/orders";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

const STAR_WORDS = ["", "Poor", "Not great", "Okay", "Good", "Loved it"];

/**
 * The review page from the SMS two days after delivery: the order's products, a star picker each, an optional line.
 * No account — the signed link is the key. Every review waits for the store's approval before it shows.
 */
export default function ReviewLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { data, isLoading, error } = useQuery({ queryKey: ["review-link", code], queryFn: () => getReviewLink(code), retry: false });
  const order = data?.order;

  return (
    <StorefrontPage>
      <StorefrontPageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Star size={14} aria-hidden="true" /> Your review
          </span>
        }
        title={error ? "Link not found" : order ? (order.firstName ? `How was it, ${order.firstName}?` : "How was your order?") : "Your review"}
      />
      <div className="max-w-[30rem] space-y-4" data-testid="review-link">
        {isLoading && <p className="ui-delayed text-sm text-ink-500">Loading…</p>}
        {error && <p className="text-sm text-ink-500">This link isn&apos;t valid. Please check the link in your SMS, or contact us.</p>}
        {order && !order.canReview && <p className="text-sm text-ink-600">You can rate this order once it has been delivered.</p>}
        {order?.canReview && (
          <>
            <p className="text-sm text-ink-600">Tap the stars — a line about it helps other customers too. It takes a minute.</p>
            {order.items.map((item) => (
              <ProductReviewCard key={item.productId} code={code} item={item} />
            ))}
            {order.items.every((i) => i.reviewed) && (
              <p className="text-sm text-ink-600">
                Thank you! <Link href="/" className="underline underline-offset-4">Back to the shop</Link>
              </p>
            )}
          </>
        )}
      </div>
    </StorefrontPage>
  );
}

function ProductReviewCard({ code, item }: { code: string; item: ReviewLinkView["items"][number] }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await submitReviewLink(code, { productId: item.productId, rating, body: body.trim() || undefined });
      await queryClient.invalidateQueries({ queryKey: ["review-link", code] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send your review — please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-5" data-testid="review-link-item">
      <div className="flex items-center gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-50">
          {item.imageUrl && <Image src={resolveImageUrl(item.imageUrl)} alt={item.name} fill sizes="56px" className="object-cover" />}
        </div>
        <p className="min-w-0 flex-1 text-sm font-medium text-ink-900">{item.name}</p>
      </div>

      {item.reviewed ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-700" role="status">
          <CheckCircle2 size={18} className="shrink-0 text-success-600" aria-hidden="true" />
          Thanks — you gave it {item.rating} star{item.rating === 1 ? "" : "s"}.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div role="radiogroup" aria-label={`Rating for ${item.name}`} className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                onClick={() => setRating(n)}
                className="flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90"
                data-testid={`review-star-${n}`}
              >
                <Star size={28} aria-hidden="true" className={cn(n <= rating ? "fill-brass-400 text-brass-400" : "text-ink-300")} />
              </button>
            ))}
            <span className="ml-2 text-sm text-ink-600" aria-live="polite">
              {STAR_WORDS[rating]}
            </span>
          </div>
          {rating > 0 && (
            <>
              <Textarea rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What did you like? (optional)" aria-label="Your review (optional)" />
              <Button className="w-full" onClick={submit} disabled={busy} data-testid="review-link-send">
                {busy ? "Sending…" : "Send review"}
              </Button>
            </>
          )}
          {error && (
            <p className="text-sm text-danger-600" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
