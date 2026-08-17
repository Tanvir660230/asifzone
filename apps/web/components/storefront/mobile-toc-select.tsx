"use client";

import { Select } from "@/components/ui/select";

interface MobileTocSelectProps {
  sections: Array<{ id: string; title: string }>;
}

/** The sticky in-page table of contents on long content pages (Privacy Policy, Terms) is
 * `hidden lg:block` — desktop-only. Below that breakpoint there's otherwise no in-page navigation
 * at all besides scrolling. This gives mobile/tablet readers the same jump targets via a plain
 * native select; each section already carries `scroll-mt-28` so the browser's own anchor-scroll
 * lands below the sticky header without extra JS. */
export function MobileTocSelect({ sections }: MobileTocSelectProps) {
  return (
    <div className="mb-8 lg:hidden">
      <label htmlFor="mobile-toc" className="sr-only">
        Jump to section
      </label>
      <Select
        id="mobile-toc"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) window.location.hash = e.target.value;
        }}
      >
        <option value="">Jump to a section…</option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </Select>
    </div>
  );
}
