"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, usePathname } from "next/navigation";
import { Heart } from "lucide-react";
import { listWishlist, addToWishlist, removeFromWishlist } from "@/lib/api/wishlist";
import { useOptionalCustomer } from "@/hooks/use-current-customer";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface WishlistButtonProps {
  productId: string;
  className?: string;
}

export function WishlistButton({ productId, className }: WishlistButtonProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  // Skip the wishlist fetch entirely for guests — it would just 401, and this hook's query is
  // already shared/cached across the page (checkout etc. call it too), so it's rarely a new request.
  const { data: customerData } = useOptionalCustomer();
  const { data } = useQuery({
    queryKey: ["wishlist"],
    queryFn: listWishlist,
    enabled: Boolean(customerData?.customer),
    retry: false,
  });
  const isSaved = data?.items.some((item) => item.productId === productId) ?? false;

  const mutation = useMutation({
    mutationFn: async () => {
      if (isSaved) await removeFromWishlist(productId);
      else await addToWishlist(productId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wishlist"] }),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/account/login?next=${encodeURIComponent(pathname)}`);
      }
    },
  });

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    mutation.mutate();
  }

  return (
    <button
      onClick={handleClick}
      aria-label={isSaved ? "Remove from wishlist" : "Add to wishlist"}
      aria-pressed={isSaved}
      disabled={mutation.isPending}
      className={cn(
        "glass glossy flex h-9 w-9 items-center justify-center rounded-full text-ink-700 shadow-float transition-all duration-200 ease-smooth hover:scale-110 hover:text-danger-600 active:scale-95 disabled:opacity-50",
        className,
      )}
    >
      <Heart size={16} className={isSaved ? "fill-danger-600 text-danger-600" : ""} />
    </button>
  );
}
