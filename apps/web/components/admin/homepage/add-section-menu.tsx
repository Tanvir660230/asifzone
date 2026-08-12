"use client";

import { Plus } from "lucide-react";
import { REPEATABLE_SECTION_TYPES, type HomepageSectionType } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { SECTION_META } from "./section-meta";

export function AddSectionMenu({ onAdd }: { onAdd: (type: HomepageSectionType) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {REPEATABLE_SECTION_TYPES.map((type) => (
        <Button key={type} type="button" variant="outline" size="sm" onClick={() => onAdd(type)}>
          <Plus size={14} /> Add {SECTION_META[type].label.toLowerCase()}
        </Button>
      ))}
    </div>
  );
}
