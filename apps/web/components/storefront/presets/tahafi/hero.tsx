import type { ComponentProps } from "react";
import { Hero } from "../../hero";
import { HangTag } from "./hang-tag";
import { TwinDiamonds } from "./twin-diamonds";

/** The Tahafi hero, drawn from the logo: on the ink ground the photograph's top edge dips like the bar of the mark (the
 * `.ui-canopy` frame) and the twin diamonds sit in the dip. The small line above the headline hangs on a tag over the
 * photograph (no eyebrow over the title). Without a photograph it is the classic hero on ink. */
export function TahafiHero(props: ComponentProps<typeof Hero>) {
  if (!props.imageUrl) return <Hero {...props} />;
  return (
    <Hero
      {...props}
      subtext={null}
      mediaOverlay={props.subtext ? <HangTag text={props.subtext} href={props.ctaHref} /> : null}
      mediaFrameClassName="ui-canopy rounded-b-3xl"
      mediaCrown={
        // Margins in % follow the frame's width, like the dip: the diamonds stay seated in it at any size.
        <TwinDiamonds className="pointer-events-none absolute left-1/2 top-0 mt-[1.25%] w-[9%] -translate-x-1/2 text-cream-100" />
      }
    />
  );
}
