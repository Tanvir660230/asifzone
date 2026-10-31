"use client";

import type { ComponentProps } from "react";
import { usePathname } from "next/navigation";
import { Footer } from "../../footer";

/** The classic footer; on the checkout, without the newsletter — a page for paying keeps the shopper on the order. */
export function TahafiFooter(props: ComponentProps<typeof Footer>) {
  const onCheckout = usePathname().startsWith("/checkout");
  if (!onCheckout) return <Footer {...props} />;
  const { settings } = props;
  const design = settings.storefrontDesign;
  return (
    <Footer
      {...props}
      settings={{ ...settings, storefrontDesign: { ...design, footer: { ...design?.footer, showNewsletter: false } } as typeof design }}
    />
  );
}
