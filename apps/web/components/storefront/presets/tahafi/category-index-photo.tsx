"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

type Photo = { id: string; url: string; alt: string } | null;

/**
 * The large photograph beside the category index on wide screens (sections.tsx): it shows the category under the pointer
 * or keyboard focus, the first one with a photograph otherwise. It listens on the list next to it (its links carry
 * `data-index-item`), so the list itself stays plain server-rendered links.
 */
export function CategoryIndexPhoto({ photos }: { photos: Photo[] }) {
  const first = Math.max(0, photos.findIndex(Boolean));
  const [active, setActive] = useState(first);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = ref.current?.parentElement;
    if (!list) return;
    const pick = (e: Event) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-index-item]");
      const index = item ? Number(item.dataset.indexItem) : NaN;
      if (Number.isInteger(index) && photos[index]) setActive(index);
    };
    list.addEventListener("pointerover", pick);
    list.addEventListener("focusin", pick);
    return () => {
      list.removeEventListener("pointerover", pick);
      list.removeEventListener("focusin", pick);
    };
  }, [photos]);

  if (!photos.some(Boolean)) return null;
  return (
    <div ref={ref} className="relative hidden aspect-[4/5] overflow-hidden rounded-b-3xl bg-cream-200 lg:block">
      {photos.map(
        (photo, i) =>
          photo && (
            <Image
              key={photo.id}
              src={photo.url}
              alt={i === active ? photo.alt : ""}
              fill
              sizes="40vw"
              className={`object-cover transition-opacity duration-500 ease-smooth ${i === active ? "opacity-100" : "opacity-0"}`}
            />
          ),
      )}
    </div>
  );
}
