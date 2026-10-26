import type { ComponentProps } from "react";
import { Hero } from "../../hero";
import { HangTag } from "./hang-tag";

/** The Tahafi hero: the base editorial composition, with the small line above the headline moved onto a hang-tag over the
 * photograph (no eyebrow over the title). Without a photograph the line stays where the base design puts it. */
export function TahafiHero(props: ComponentProps<typeof Hero>) {
  if (!props.imageUrl || !props.subtext) return <Hero {...props} />;
  return <Hero {...props} subtext={null} mediaOverlay={<HangTag text={props.subtext} href={props.ctaHref} />} />;
}
