"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

export function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  function goTo(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mt-10 flex items-center justify-center gap-3">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
        Previous
      </Button>
      <span className="text-sm text-ink-500">
        Page {page} of {totalPages}
      </span>
      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => goTo(page + 1)}>
        Next
      </Button>
    </div>
  );
}
