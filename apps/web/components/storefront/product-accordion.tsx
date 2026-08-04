"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccordionItem {
  title: string;
  content: string;
}

export function ProductAccordion({ items }: { items: AccordionItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

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
            <div
              className={cn(
                "grid overflow-hidden transition-all duration-300",
                isOpen ? "grid-rows-[1fr] pb-4 opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <p className="overflow-hidden text-sm leading-relaxed text-ink-600">{item.content}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
