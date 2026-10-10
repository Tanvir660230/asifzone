"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Opens a page's create dialog when the URL asks for it (`?new=<kind>`) — how the shell's Create menu and other pages
 * deep-link straight into "Record expense", "New purchase order"… The parameter is removed once handled, so a refresh
 * or Back doesn't reopen the dialog. Works when the page is already open too (the Create menu used on that page).
 */
export function useCreateParam(kind: string, open: () => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("new") === kind;
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!requested) return;
    openRef.current();
    const rest = new URLSearchParams(params.toString());
    rest.delete("new");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [requested, params, pathname, router]);
}
