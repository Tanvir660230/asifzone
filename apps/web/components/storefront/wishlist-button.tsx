"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { listWishlist, addToWishlist, removeFromWishlist } from "@/lib/api/wishlist";
import { useWishlistStore } from "@/store/wishlist";
import { useOptionalCustomer } from "@/hooks/use-current-customer";
import { cn } from "@/lib/utils";

interface WishlistButtonProps {
  productId: string;
  className?: string;
}

export function WishlistButton({ productId, className }: WishlistButtonProps) {
  const queryClient = useQueryClient();

  // Guests get a fully working wishlist that never leaves the browser (mirrors the cart store) —
  // no login prompt on tap. It's pushed up to the account automatically right after they do log in
  // (see mergeGuestWishlist, called from the login/register pages), at which point this switches to
  // the server-backed path below like it always has for a signed-in customer.
  const { data: customerData } = useOptionalCustomer();
  const isLoggedIn = Boolean(customerData?.customer);

  const localIds = useWishlistStore((s) => s.productIds);
  const toggleLocal = useWishlistStore((s) => s.toggle);

  const { data } = useQuery({
    queryKey: ["wishlist"],
    queryFn: listWishlist,
    enabled: isLoggedIn,
    retry: false,
  });
  const serverSaved = data?.items.some((item) => item.productId === productId) ?? false;
  const isSaved = isLoggedIn ? serverSaved : localIds.includes(productId);

  const mutation = useMutation({
    mutationFn: async () => {
      if (serverSaved) await removeFromWishlist(productId);
      else await addToWishlist(productId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wishlist"] }),
  });

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isLoggedIn) mutation.mutate();
    else toggleLocal(productId);
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
