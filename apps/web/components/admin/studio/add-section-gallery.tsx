"use client";

import type { ReactNode } from "react";
import { homepageSectionTypeEnum, REPEATABLE_SECTION_TYPES, type HomepageSectionType, type StudioSection } from "@clothing-brand/shared";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { SECTION_META } from "./section-meta";

/** The order sections are offered in: the ones a store adds most first. */
const GALLERY_ORDER: HomepageSectionType[] = [
  "PRODUCT_CAROUSEL",
  "BRAND_STORY",
  "PROMO_BANNER",
  "IMAGE_GALLERY",
  "TESTIMONIALS",
  "RICH_TEXT",
  "VALUES_GRID",
  "NEWSLETTER",
  "HERO",
  "CATEGORY_GRID",
  "TRUST_STRIP",
  "FLASH_SALE",
  "PERSONALIZED_LEAD",
  "SMART_RECOMMENDATIONS",
];

// Every type is offered (the enum is the source of truth; a type missing above goes last).
const ORDER = [...GALLERY_ORDER, ...homepageSectionTypeEnum.options.filter((t) => !GALLERY_ORDER.includes(t))];

/* Mini wireframes, drawn with the admin's own neutral tokens — a sketch of each section's shape, not a screenshot. */
const bar = (w: string, tone = "bg-ink-300") => <span className={cn("block h-1.5 rounded-full", tone, w)} />;
const block = (className: string) => <span className={cn("block rounded-[3px] bg-ink-200", className)} />;
const dark = "bg-ink-800";

const SKETCH: Record<HomepageSectionType, ReactNode> = {
  HERO: (
    <span className={cn("flex h-full flex-col justify-center gap-1.5 rounded-md p-3", dark)}>
      {bar("w-2/3", "bg-ink-400")}
      {bar("w-1/2", "bg-ink-500")}
      <span className="mt-1 block h-3 w-10 rounded-full bg-ink-200" />
    </span>
  ),
  TRUST_STRIP: (
    <span className="flex h-full items-center justify-around gap-1 px-2">
      {[0, 1, 2].map((i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full bg-ink-300" />
          {bar("w-6")}
        </span>
      ))}
    </span>
  ),
  PERSONALIZED_LEAD: (
    <span className="flex h-full flex-col justify-center gap-1.5 p-3">
      {bar("w-1/3", "bg-ink-200")}
      <span className="grid grid-cols-4 gap-1">{[0, 1, 2, 3].map((i) => <span key={i}>{block("aspect-[3/4]")}</span>)}</span>
    </span>
  ),
  PRODUCT_CAROUSEL: (
    <span className="flex h-full flex-col justify-center gap-1.5 p-3">
      {bar("w-1/3")}
      <span className="grid grid-cols-4 gap-1">{[0, 1, 2, 3].map((i) => <span key={i}>{block("aspect-[3/4]")}</span>)}</span>
    </span>
  ),
  FLASH_SALE: (
    <span className="flex h-full flex-col justify-center gap-1.5 p-3">
      <span className="flex justify-between">{bar("w-1/3")}{bar("w-1/5", "bg-danger-300")}</span>
      <span className="grid grid-cols-4 gap-1">{[0, 1, 2, 3].map((i) => <span key={i}>{block("aspect-[3/4]")}</span>)}</span>
    </span>
  ),
  CATEGORY_GRID: (
    <span className="grid h-full grid-cols-3 grid-rows-2 gap-1 p-3">
      <span className="col-span-2">{block("h-full")}</span>
      {block("h-full")}
      {block("h-full")}
      <span className="col-span-2">{block("h-full")}</span>
    </span>
  ),
  BRAND_STORY: (
    <span className={cn("grid h-full grid-cols-2 items-center gap-2 rounded-md p-3", dark)}>
      <span className="space-y-1.5">
        {bar("w-full", "bg-ink-400")}
        {bar("w-2/3", "bg-ink-500")}
      </span>
      <span className="block h-full rounded-[3px] bg-ink-600" />
    </span>
  ),
  VALUES_GRID: (
    <span className="grid h-full grid-cols-3 gap-2 p-3">
      <span className="space-y-1">{bar("w-full")}{bar("w-2/3", "bg-ink-200")}</span>
      <span className="col-span-2 grid grid-cols-2 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="space-y-1 border-t border-ink-300 pt-1">{bar("w-3/4", "bg-ink-200")}</span>
        ))}
      </span>
    </span>
  ),
  SMART_RECOMMENDATIONS: (
    <span className="flex h-full flex-col items-center justify-center gap-1.5 p-3">
      {bar("w-1/3")}
      <span className="grid w-full grid-cols-5 gap-1">{[0, 1, 2, 3, 4].map((i) => <span key={i}>{block("aspect-square")}</span>)}</span>
    </span>
  ),
  PROMO_BANNER: (
    <span className="flex h-full items-center p-3">
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-[3px] bg-ink-300">
        {bar("w-1/2", "bg-ink-50")}
        <span className="block h-2.5 w-8 rounded-sm border border-ink-50" />
      </span>
    </span>
  ),
  RICH_TEXT: (
    <span className="flex h-full flex-col justify-center gap-1.5 p-3">
      {bar("w-1/2", "bg-ink-400")}
      {bar("w-full", "bg-ink-200")}
      {bar("w-5/6", "bg-ink-200")}
    </span>
  ),
  TESTIMONIALS: (
    <span className="grid h-full grid-cols-3 gap-1.5 p-3">
      {[0, 1, 2].map((i) => (
        <span key={i} className="flex flex-col gap-1 rounded-[3px] border border-ink-200 p-1.5">
          <span className="text-[7px] leading-none tracking-tighter text-warning-500">★★★★★</span>
          {bar("w-full", "bg-ink-200")}
          {bar("w-2/3", "bg-ink-200")}
        </span>
      ))}
    </span>
  ),
  NEWSLETTER: (
    <span className="grid h-full grid-cols-2 items-center gap-2 border-y border-ink-200 px-3">
      <span className="space-y-1">{bar("w-full")}{bar("w-2/3", "bg-ink-200")}</span>
      <span className="flex gap-1">
        <span className="h-3 flex-1 rounded-sm border border-ink-300" />
        <span className="h-3 w-5 rounded-sm bg-ink-400" />
      </span>
    </span>
  ),
  IMAGE_GALLERY: (
    <span className="grid h-full grid-cols-4 grid-rows-2 gap-1 p-3">
      <span className="col-span-2 row-span-2">{block("h-full")}</span>
      {block("h-full")}
      {block("h-full")}
      {block("h-full")}
      {block("h-full")}
    </span>
  ),
};

interface AddSectionGalleryProps {
  open: boolean;
  onClose: () => void;
  sections: StudioSection[];
  onAdd: (type: HomepageSectionType) => void;
}

/** Pick a section to add — each card a sketch of how it sits on the page. Sections a homepage has only one of are shown
 * but disabled once present (switch the existing one on instead). */
export function AddSectionGallery({ open, onClose, sections, onAdd }: AddSectionGalleryProps) {
  return (
    <Modal open={open} onClose={onClose} title="Add a section" description="It goes below the selected section — drag it anywhere afterwards." widthClassName="max-w-4xl">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="studio-section-gallery">
        {ORDER.map((type) => {
          const meta = SECTION_META[type];
          const taken = !REPEATABLE_SECTION_TYPES.includes(type) && sections.some((s) => s.type === type);
          return (
            <li key={type}>
              <button
                type="button"
                disabled={taken}
                onClick={() => onAdd(type)}
                className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left transition-[border-color,box-shadow,transform] duration-fast ease-smooth hover:-translate-y-px hover:border-line-strong hover:shadow-float disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                data-testid={`gallery-${type}`}
              >
                <span aria-hidden="true" className="block h-24 border-b border-line-subtle bg-surface-muted">
                  {SKETCH[type]}
                </span>
                <span className="block p-3">
                  <span className="block text-sm font-medium text-fg">{meta.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{taken ? "Already on the page — switch it on there." : meta.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
