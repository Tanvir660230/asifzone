"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccordionItem {
  title: string;
  content: string;
  /** When true, `content` is pre-sanitized HTML (e.g. the admin's rich-text product description)
   * rendered via dangerouslySetInnerHTML instead of plain text. */
  html?: boolean;
}

export function ProductAccordion({ items }: { items: AccordionItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="mt-8 divide-y divide-ink-100 border-t border-ink-100">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div key={item.title}>
            <button
              onClick={() => setOpenIndex(isOpen ? null : i)}
              className="flex w-full items-center justify-between py-4 text-left text-sm uppercase tracking-wide text-ink-900"
              aria-expanded={isOpen}
            >
              {item.title}
              <ChevronDown size={16} className={cn("transition-transform", isOpen && "rotate-180")} />
            </button>
            {/* Collapsed renders nothing at all (grid-rows-[0fr] collapses the row to zero height)
                rather than a peeking preview — the toggle itself is the only thing shown until
                a visitor actually opens it. */}
            <div
              className={cn(
                "grid overflow-hidden transition-all duration-300",
                isOpen ? "grid-rows-[1fr] pb-4 opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                {item.html ? (
                  <div
                    className="prose prose-sm max-w-none prose-headings:font-display prose-headings:text-ink-900 prose-p:text-ink-600 prose-li:text-ink-600 prose-strong:text-ink-900"
                    dangerouslySetInnerHTML={{ __html: item.content }}
                  />
                ) : (
                  <p className="text-sm leading-relaxed text-ink-600">{item.content}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
