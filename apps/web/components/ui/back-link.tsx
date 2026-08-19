"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BackLinkProps {
  /** Navigates to a fixed route (e.g. "/admin/orders"). Use this over onClick whenever the
   * destination is known — it's a real link (middle-click/open-in-new-tab work) rather than a
   * JS-only handler. When the visitor actually arrived here by clicking through the app (not a
   * fresh page load from a bookmark/email link/new tab), a plain click prefers real browser
   * back-navigation instead — that's what returns them to wherever they came from with filters,
   * search, and scroll position intact, rather than always landing on this fixed destination. */
  href?: string;
  /** For cases with no single fixed destination, e.g. router.back(), or a page-vs-drawer
   * component that only needs this affordance in its "page" variant. */
  onClick?: () => void;
  label: string;
}

/** The single "how do I get back" affordance used across every detail/sub-page in the app —
 * always this icon, this label position, this button style, so it reads the same everywhere
 * instead of each page inventing its own back-navigation treatment. */
export function BackLink({ href, onClick, label }: BackLinkProps) {
  const router = useRouter();

  function handleLinkClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (typeof window === "undefined" || window.history.length <= 1 || !document.referrer) return;
    try {
      if (new URL(document.referrer).origin !== window.location.origin) return;
    } catch {
      return;
    }
    e.preventDefault();
    router.back();
  }

  const button = (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <ArrowLeft size={16} /> {label}
    </Button>
  );

  if (href) {
    return (
      <Link href={href} onClick={handleLinkClick}>
        {button}
      </Link>
    );
  }
  return button;
}
