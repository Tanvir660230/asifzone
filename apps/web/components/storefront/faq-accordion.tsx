"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FaqGroup {
  category: string;
  items: { question: string; answer: React.ReactNode }[];
}

/** Grouped, single-open-per-page accordion (flat "group:index" keys so opening a question in one
 * category collapses whichever was open elsewhere) — used instead of one long flat list so a
 * visitor can scan by topic (Orders, Shipping, Returns, Payment) instead of reading every answer. */
export function FaqAccordion({ groups }: { groups: FaqGroup[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <div key={group.category}>
          <h2 className="mb-3 text-xs uppercase tracking-[0.2em] text-ink-400">{group.category}</h2>
          <div className="divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-cream-50 px-5">
            {group.items.map((item, i) => {
              const key = `${group.category}:${i}`;
              const isOpen = openKey === key;
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => setOpenKey(isOpen ? null : key)}
                    className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium text-ink-900"
                    aria-expanded={isOpen}
                  >
                    {item.question}
                    <ChevronDown size={16} className={cn("shrink-0 text-ink-400 transition-transform duration-200 ease-smooth", isOpen && "rotate-180")} />
                  </button>
                  <div
                    className={cn(
                      "grid overflow-hidden transition-all duration-300",
                      isOpen ? "grid-rows-[1fr] pb-4 opacity-100" : "grid-rows-[0fr] opacity-0",
                    )}
                  >
                    <p className="overflow-hidden text-sm leading-relaxed text-ink-500">{item.answer}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
