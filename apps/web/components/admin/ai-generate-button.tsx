"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/spinner";

/** Inline "Generate with AI" action next to a field label. The caller decides what to generate and where it goes;
 * this only handles the busy state and a readable error. Render it only when AI is available to this admin. */
export function AiGenerateButton({ onGenerate, disabled, label = "Generate with AI" }: { onGenerate: () => Promise<unknown>; disabled?: boolean; label?: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await onGenerate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "AI generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-ink-600 transition-colors duration-fast hover:bg-ink-900/[0.05] hover:text-fg disabled:opacity-50"
    >
      {loading ? <Spinner size={12} /> : <Sparkles size={12} aria-hidden="true" />} {loading ? "Generating…" : label}
    </button>
  );
}
