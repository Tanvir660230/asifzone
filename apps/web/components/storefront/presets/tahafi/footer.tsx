import type { ComponentProps } from "react";
import { resolveImageUrl } from "@/lib/image-url";
import { StoreLogoImage } from "@/components/store-logo-image";
import { Footer } from "../../footer";
import { Canopy } from "./canopy";

/** The Tahafi footer: the classic footer's content on ink, the cream page dipping into its top edge like the bar of the
 * mark, and the store's logo set the full width of the page above the bottom bar. */
export function TahafiFooter(props: ComponentProps<typeof Footer>) {
  const { settings } = props;
  const logoUrl = settings.logoOnDarkUrl ?? settings.logoUrl;
  return (
    <Footer
      {...props}
      crown={<Canopy className="fill-canvas" />}
      signature={
        logoUrl ? (
          <div className="pb-10 pt-4 sm:pb-14">
            <StoreLogoImage src={resolveImageUrl(logoUrl)} alt="" className="mx-auto block h-auto w-full max-w-3xl object-contain" fallback={null} />
          </div>
        ) : null
      }
    />
  );
}
