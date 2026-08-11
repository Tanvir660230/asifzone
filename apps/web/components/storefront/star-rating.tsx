"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  value: number;
  size?: number;
  className?: string;
}

/** Read-only stars — supports fractional fill (e.g. 3.4) via a clipped overlay per star, so an
 * average rating doesn't get rounded to the nearest whole star. */
export function StarRating({ value, size = 14, className }: StarRatingProps) {
  return (
    <div className={cn("flex items-center gap-0.5", className)} aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star size={size} className="absolute inset-0 text-ink-200" />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star size={size} className="fill-brass-400 text-brass-400" />
            </span>
          </span>
        );
      })}
    </div>
  );
}

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
  size?: number;
}

/** Interactive star picker for the "write a review" form — hover preview + click to set. */
export function StarRatingInput({ value, onChange, size = 24 }: StarRatingInputProps) {
  const [hovered, setHovered] = useState(0);
  const display = hovered || value;

  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setHovered(0)}>
      {Array.from({ length: 5 }, (_, i) => {
        const star = i + 1;
        return (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            onMouseEnter={() => setHovered(star)}
            aria-label={`Rate ${star} out of 5`}
            className="transition-transform duration-150 ease-smooth hover:scale-110"
          >
            <Star size={size} className={star <= display ? "fill-brass-400 text-brass-400" : "text-ink-200"} />
          </button>
        );
      })}
    </div>
  );
}
