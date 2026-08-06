"use client";

import type { SocialLink } from "@clothing-brand/shared";
import { useCartCount } from "@/store/cart";

function WhatsAppGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.51 2 12.04 2zm5.8 14.02c-.24.68-1.4 1.33-1.94 1.4-.5.06-1.03.1-1.6-.07-.36-.1-.83-.26-1.43-.51-2.53-1.09-4.18-3.63-4.31-3.8-.13-.17-1.03-1.37-1.03-2.61s.65-1.85.88-2.1c.23-.25.5-.31.67-.31.17 0 .33 0 .48.01.16.01.36-.06.56.43.24.57.8 1.98.87 2.12.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.16-.29.36-.42.48-.14.13-.28.28-.13.55.16.28.7 1.16 1.51 1.88 1.04.93 1.92 1.22 2.19 1.36.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.18-.28.36-.23.61-.14.24.09 1.55.73 1.82.87.27.14.45.2.51.32.07.11.07.66-.17 1.34z" />
    </svg>
  );
}

interface WhatsAppButtonProps {
  socialLinks: SocialLink[];
}

/** Uses whatever active WHATSAPP social link the admin already set (Social Links settings) —
 * that's the single source of truth for the number/URL, not a second config to keep in sync. */
export function WhatsAppButton({ socialLinks }: WhatsAppButtonProps) {
  const cartHasItems = useCartCount() > 0;
  const whatsapp = socialLinks.find((l) => l.platform === "WHATSAPP");
  if (!whatsapp) return null;

  return (
    <a
      href={whatsapp.url}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat with us on WhatsApp"
      title="Chat on WhatsApp"
      className={`fixed right-4 z-40 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#25D366] text-white shadow-floatLg transition-all duration-200 ease-smooth hover:scale-110 active:scale-95 ${cartHasItems ? "bottom-24" : "bottom-6"}`}
    >
      <WhatsAppGlyph />
    </a>
  );
}
