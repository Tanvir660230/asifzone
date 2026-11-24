"use client";

import { SocialIcon } from "@/components/social-icon";
import { pixelContact } from "@/lib/pixels";
import { BUY } from "@/lib/buy-copy";
import { productOrderMessage, withWhatsAppMessage, type WhatsAppOrderLine } from "@/lib/whatsapp";

interface WhatsAppOrderButtonProps {
  /** The store's WhatsApp link (its active WHATSAPP social link). */
  whatsappUrl: string;
  productName: string;
  options: WhatsAppOrderLine["options"];
  /** `button` (default): a full-width outlined button. `link`: a quiet text link with the icon, for a page that keeps two
   * main actions and offers WhatsApp as the alternative (the tahafi preset). Both keep at least a 44px hit area. */
  look?: "button" | "link";
}

/** "Order on WhatsApp": opens a chat with the store, the message already written (the product, the options chosen so far
 * and this page's link), for shoppers who would rather confirm with a person than fill in the checkout. */
export function WhatsAppOrderButton({ whatsappUrl, productName, options, look = "button" }: WhatsAppOrderButtonProps) {
  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    // The link is built at click time so it carries the current options and the page's own address.
    const message = productOrderMessage({ productName, options, quantity: 1, url: window.location.href.split("#")[0]! });
    event.currentTarget.href = withWhatsAppMessage(whatsappUrl, message);
    pixelContact("whatsapp");
  }

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
      className={
        look === "link"
          ? "mx-auto flex h-11 w-fit items-center justify-center gap-2 px-3 text-sm font-medium text-fg-muted underline-offset-4 transition-colors duration-200 ease-smooth hover:text-fg hover:underline"
          : "flex h-12 w-full items-center justify-center gap-2 rounded-full border border-line-strong text-sm font-medium text-ink-900 transition-colors duration-200 ease-smooth hover:border-ink-900 hover:bg-surface-muted active:scale-[0.99]"
      }
      data-testid="whatsapp-order"
      data-fab-collision
    >
      <SocialIcon platform="WHATSAPP" size={18} />
      {BUY.whatsappOrder}
    </a>
  );
}
