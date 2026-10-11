"use client";

import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { normalizeProductTag } from "@clothing-brand/shared";

interface TagInputProps {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  max?: number;
}

/** YouTube-style tag field: type a tag, press Enter or comma, and it becomes a chip. Backspace in the empty field
 * removes the last chip; pasting "a, b, c" adds all three. Tags are normalized the way the API stores them, so a
 * duplicate ("Ator" after "ator") is simply ignored. */
export function TagInput({ id, value, onChange, max = 40 }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const next = [...value];
    for (const tag of raw.split(/[,،\n]/).map(normalizeProductTag)) {
      if (tag && !next.includes(tag) && next.length < max) next.push(tag);
    }
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // A Bangla (or any IME) keyboard confirms its composition with Enter — that Enter isn't "add this tag".
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (draft.trim()) add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[,،\n]/.test(text)) return;
    e.preventDefault();
    add(draft + text);
  };

  const full = value.length >= max;

  return (
    <div>
      <div className="ui-control flex h-auto min-h-10 flex-wrap items-center gap-1.5 py-1.5">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-surface-muted py-0.5 pl-2.5 pr-1 text-xs text-ink-700 ring-1 ring-inset ring-line-subtle">
            {tag}
            <button
              type="button"
              className="rounded-full p-0.5 text-fg-muted hover:bg-line-subtle hover:text-ink-900"
              aria-label={`Remove tag ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={full ? `Up to ${max} tags` : value.length ? "Add another…" : "Type a tag and press Enter"}
          className="min-w-[8rem] flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:ring-0"
          autoComplete="off"
        />
      </div>
      <p className="mt-1 text-right text-xs text-fg-muted">
        {value.length}/{max}
      </p>
    </div>
  );
}
