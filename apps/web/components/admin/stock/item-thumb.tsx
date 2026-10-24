"use client";

import { useState } from "react";
import { Boxes, Droplet, FlaskConical, Package, ShoppingBag, Sticker, type LucideIcon } from "lucide-react";
import { Thumbnail } from "@/components/admin/thumbnail";
import { cn } from "@/lib/utils";

/** What a material is, from its name and unit — for the icon shown when it has no picture. */
function kindIcon(name: string, unit: string, attar: boolean): LucideIcon {
  const n = name.toLowerCase();
  if (attar) return FlaskConical;
  if (["ml", "l", "g", "kg"].includes(unit.toLowerCase()) || n.includes("oil")) return Droplet;
  if (n.includes("bottle")) return FlaskConical;
  if (n.includes("sticker") || n.includes("label")) return Sticker;
  if (n.includes("poly") || n.includes("bag")) return ShoppingBag;
  if (n.includes("box")) return Package;
  return Boxes;
}

const SIZE = { sm: "h-9 w-9 rounded-lg", md: "h-11 w-11 rounded-xl", lg: "h-16 w-16 rounded-2xl" } as const;
const ICON = { sm: "h-4 w-4", md: "h-5 w-5", lg: "h-7 w-7" } as const;

/** The item's picture, or — with none — a calm tile with the icon of what it is. */
export function ItemThumb({ imageUrl, name, unit = "pcs", attar = false, size = "md", className }: { imageUrl: string | null; name: string; unit?: string; attar?: boolean; size?: keyof typeof SIZE; className?: string }) {
  // a picture that can't load (moved, or not on this machine) falls back to the icon, never a broken image
  const [broken, setBroken] = useState(false);
  if (imageUrl && !broken) {
    return (
      <span className={cn("block shrink-0 overflow-hidden bg-surface-muted ring-1 ring-inset ring-ink-900/[0.06]", SIZE[size], className)}>
        <Thumbnail src={imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" onFallbackFailed={() => setBroken(true)} />
      </span>
    );
  }
  const Icon = kindIcon(name, unit, attar);
  return (
    <span className={cn("grid shrink-0 place-items-center bg-ink-900/[0.045] text-fg-muted", SIZE[size], className)} aria-hidden="true">
      <Icon className={ICON[size]} strokeWidth={1.75} />
    </span>
  );
}

/** A few pictures overlapping, then "+N" — the items one event touched. */
export function ThumbStack({ items, max = 4 }: { items: Array<{ variantId: string; imageUrl: string | null; name: string; unit: string }>; max?: number }) {
  const shown = items.slice(0, max);
  return (
    <span className="flex items-center">
      {shown.map((i, k) => <ItemThumb key={i.variantId} imageUrl={i.imageUrl} name={i.name} unit={i.unit} size="sm" className={cn("ring-2 ring-surface", k > 0 && "-ml-2")} />)}
      {items.length > max && <span className="-ml-2 grid h-9 min-w-9 place-items-center rounded-lg bg-ink-900/[0.06] px-1.5 text-xs font-medium text-fg-muted ring-2 ring-surface">+{items.length - max}</span>}
    </span>
  );
}

/** The query's words, marked where they appear in a name — so a match reads at a glance. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2 && !/[-_]/.test(w));
  if (!words.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(pattern);
  return <>{parts.map((p, k) => (k % 2 === 1 ? <mark key={k} className="rounded-[3px] bg-accent/15 px-0.5 text-fg">{p}</mark> : p))}</>;
}
