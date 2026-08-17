"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BackLinkProps {
  /** Navigates to a fixed route (e.g. "/admin/orders"). Use this over onClick whenever the
   * destination is known — it's a real link (middle-click/open-in-new-tab work) rather than a
   * JS-only handler. */
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
  const button = (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <ArrowLeft size={16} /> {label}
    </Button>
  );

  if (href) {
    return <Link href={href}>{button}</Link>;
  }
  return button;
}
