"use client";

import { Share2 } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";

/** Share this page: the device's own share sheet where there is one (phones: WhatsApp, Messenger…), otherwise the link
 * is copied. A dismissed share sheet is not an error. */
export function ShareButton({ title, className }: { title: string; className?: string }) {
  async function share() {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
      } catch {
        // Closed without sharing.
      }
      return;
    }
    await copyToClipboard(url, "Link copied");
  }

  return (
    <button
      type="button"
      onClick={share}
      aria-label="Share this product"
      title="Share"
      className={
        className ??
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-ink-700 transition-[border-color,color,transform] duration-200 ease-smooth hover:border-ink-900 hover:text-ink-900 active:scale-95"
      }
    >
      <Share2 size={17} aria-hidden="true" />
    </button>
  );
}
