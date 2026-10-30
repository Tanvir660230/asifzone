import { cn } from "@/lib/utils";

/**
 * The bar of Tahafi's mark as an edge between two grounds: a band the full width of the page whose lower edge dips in a
 * curve, a tenth as deep as it is wide on a phone and shallower on wide screens. Placed at the top of a section, in the
 * colour of the ground above it (`className` sets the fill), it reads as that ground hanging down into the section — the
 * header into the hero, the cream page into the footer.
 */
export function Canopy({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      className={cn("pointer-events-none block h-[clamp(2.25rem,6vw,5.5rem)] w-full", className)}
    >
      <path d="M0 0H100Q50 20 0 0Z" />
    </svg>
  );
}
