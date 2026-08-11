"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, usePathname } from "next/navigation";
import { BadgeCheck, MessageSquare } from "lucide-react";
import { getMyReviewForProduct, getProductReviews, submitReview } from "@/lib/api/reviews";
import { useOptionalCustomer } from "@/hooks/use-current-customer";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { StarRating, StarRatingInput } from "./star-rating";

const PAGE_SIZE = 10;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

function RatingBar({ star, count, total }: { star: number; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-xs text-ink-500">
      <span className="w-8 shrink-0">{star} star</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full rounded-full bg-brass-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right text-ink-400">{count}</span>
    </div>
  );
}

function WriteReviewForm({ productId, onDone }: { productId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const mutation = useMutation({
    mutationFn: () => submitReview({ productId, rating, title: title || null, body }),
    onSuccess: () => {
      toast.success("Thanks — your review is pending approval.");
      queryClient.invalidateQueries({ queryKey: ["my-review", productId] });
      onDone();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't submit your review"),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0) {
      toast.error("Pick a star rating first");
      return;
    }
    if (body.trim().length < 10) {
      toast.error("Your review needs at least 10 characters");
      return;
    }
    mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-ink-100 bg-cream-50 p-5 sm:p-6">
      <div className="space-y-4">
        <div>
          <Label>Your rating</Label>
          <StarRatingInput value={rating} onChange={setRating} />
        </div>
        <div>
          <Label htmlFor="review-title">Title (optional)</Label>
          <input
            id="review-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            className="h-10 w-full rounded-lg border border-ink-200 bg-cream-50 px-3 text-sm text-ink-900 transition-all duration-200 ease-smooth placeholder:text-ink-400 focus:border-brass-400 focus:shadow-glow"
            placeholder="Sum it up in a few words"
          />
        </div>
        <div>
          <Label htmlFor="review-body">Your review</Label>
          <Textarea
            id="review-body"
            required
            rows={4}
            minLength={10}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What did you like or dislike? How was the fit and quality?"
          />
        </div>
        <div className="flex gap-3">
          <Button type="submit" variant="brass" disabled={mutation.isPending}>
            {mutation.isPending ? "Submitting…" : "Submit review"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

const MY_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending approval — only visible to you until an admin approves it.",
  APPROVED: "Published — thanks for sharing your feedback!",
  REJECTED: "Not published — this review didn't meet our guidelines.",
};

export function ProductReviews({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter();
  const pathname = usePathname();
  // "Load more" grows pageSize on a fixed page=1 fetch instead of paging forward — appending a
  // second page's items to the first would need extra accumulator state; refetching a slightly
  // larger page=1 window is simpler and review lists are small enough that it's cheap either way.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [formOpen, setFormOpen] = useState(false);

  const { data: customerData } = useOptionalCustomer();
  const isLoggedIn = Boolean(customerData?.customer);

  const { data, isLoading } = useQuery({
    queryKey: ["product-reviews", productId, visibleCount],
    queryFn: () => getProductReviews(productId, 1, visibleCount),
  });

  const { data: myReviewData } = useQuery({
    queryKey: ["my-review", productId],
    queryFn: () => getMyReviewForProduct(productId),
    enabled: isLoggedIn,
    retry: false,
  });

  const breakdown = data?.breakdown;
  const myReview = myReviewData?.review;

  function handleWriteReviewClick() {
    if (!isLoggedIn) {
      router.push(`/account/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    setFormOpen(true);
  }

  return (
    <section id="reviews" className="mx-auto max-w-7xl scroll-mt-20 px-4 pb-16 sm:px-6 lg:px-8">
      <h2 className="mb-8 font-display text-2xl text-ink-900">Customer Reviews</h2>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[280px_1fr]">
        <div>
          {breakdown && breakdown.count > 0 ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-4xl text-ink-900">{breakdown.average.toFixed(1)}</span>
                <span className="text-sm text-ink-400">/ 5</span>
              </div>
              <StarRating value={breakdown.average} size={18} className="mt-1" />
              <p className="mt-1 text-sm text-ink-500">
                Based on {breakdown.count} review{breakdown.count === 1 ? "" : "s"}
              </p>
              <div className="mt-4 space-y-1.5">
                {([5, 4, 3, 2, 1] as const).map((star) => (
                  <RatingBar key={star} star={star} count={breakdown.counts[String(star) as "5"]} total={breakdown.count} />
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-400">No reviews yet — be the first to review {productName}.</p>
          )}

          <div className="mt-6">
            {myReview ? (
              <div className="rounded-xl border border-ink-100 bg-cream-50 p-4 text-sm">
                <p className="mb-1 flex items-center gap-1.5 font-medium text-ink-900">
                  <MessageSquare size={14} className="text-brass-500" />
                  Your review
                </p>
                <p className="text-xs text-ink-500">{MY_STATUS_LABEL[myReview.status]}</p>
              </div>
            ) : formOpen ? null : (
              <Button type="button" variant="outline" onClick={handleWriteReviewClick} className="w-full">
                Write a review
              </Button>
            )}
          </div>
        </div>

        <div>
          {formOpen && !myReview && (
            <div className="mb-8">
              <WriteReviewForm productId={productId} onDone={() => setFormOpen(false)} />
            </div>
          )}

          {isLoading && <p className="text-sm text-ink-400">Loading reviews…</p>}

          {!isLoading && data?.items.length === 0 && (
            <p className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400">
              No reviews yet for this product.
            </p>
          )}

          <div className="space-y-6">
            {data?.items.map((review) => (
              <div key={review.id} className={cn("border-b border-ink-100 pb-6 last:border-b-0")}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StarRating value={review.rating} />
                    {review.isVerifiedPurchase && (
                      <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-brass-600">
                        <BadgeCheck size={12} />
                        Verified Purchase
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-ink-400">{timeAgo(review.createdAt)}</span>
                </div>
                {review.title && <p className="mt-2 text-sm font-medium text-ink-900">{review.title}</p>}
                <p className="mt-1 text-sm leading-relaxed text-ink-600">{review.body}</p>
                <p className="mt-2 text-xs text-ink-400">{review.customerName}</p>
              </div>
            ))}
          </div>

          {data && data.total > visibleCount && (
            <div className="mt-6 text-center">
              <Button type="button" variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                Load more reviews
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
