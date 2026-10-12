import type { CreateReviewInput, PaginatedResult, ProductReview, RatingBreakdown } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function getProductReviews(productId: string, page = 1, pageSize = 10) {
  const query = new URLSearchParams({ productId, page: String(page), pageSize: String(pageSize) });
  return apiFetch<PaginatedResult<ProductReview> & { breakdown: RatingBreakdown }>(`/api/reviews?${query.toString()}`);
}

export function getMyReviewForProduct(productId: string) {
  return apiFetch<{ review: ProductReview | null }>(`/api/reviews/mine?productId=${productId}`);
}

/** Uploads one review photo; attach the returned reference to the review (CreateReviewInput.images). */
export function uploadReviewImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);
  return apiFetch<{ url: string }>("/api/reviews/images", { method: "POST", body: formData, isFormData: true });
}

export function submitReview(input: CreateReviewInput) {
  return apiFetch<{ review: ProductReview }>("/api/reviews", { method: "POST", body: input });
}
