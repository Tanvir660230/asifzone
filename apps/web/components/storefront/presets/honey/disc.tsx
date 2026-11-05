import { cn } from "@/lib/utils";

/** The honey preset's mark: a glowing orange disc that a product stands in front of. Decorative; its colours are tokens. */
export function Disc({ className }: { className?: string }) {
  return <div aria-hidden className={cn("ui-disc aspect-square rounded-full", className)} />;
}
