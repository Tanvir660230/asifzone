"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, MessageCircleMore, MessageSquareText, Phone, X } from "lucide-react";
import type { SocialLink, StoreSettings } from "@clothing-brand/shared";

declare global {
  interface Window {
    Tawk_API?: { toggle?: () => void };
  }
}

/** Appends/overwrites the `text` query param on a WhatsApp deep link (wa.me/... or
 * api.whatsapp.com/send?phone=...) with the admin-configured prefill message — both formats accept
 * `text`, so this works regardless of which style the SocialLink URL was pasted in as. */
function withWhatsAppMessage(url: string, message: string | null): string {
  if (!message) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("text", message);
    return parsed.toString();
  } catch {
    return url;
  }
}
import { useBottomDockState } from "@/hooks/use-bottom-dock";
import { FeedbackModal } from "./feedback-modal";

function WhatsAppGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.51 2 12.04 2zm5.8 14.02c-.24.68-1.4 1.33-1.94 1.4-.5.06-1.03.1-1.6-.07-.36-.1-.83-.26-1.43-.51-2.53-1.09-4.18-3.63-4.31-3.8-.13-.17-1.03-1.37-1.03-2.61s.65-1.85.88-2.1c.23-.25.5-.31.67-.31.17 0 .33 0 .48.01.16.01.36-.06.56.43.24.57.8 1.98.87 2.12.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.16-.29.36-.42.48-.14.13-.28.28-.13.55.16.28.7 1.16 1.51 1.88 1.04.93 1.92 1.22 2.19 1.36.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.18-.28.36-.23.61-.14.24.09 1.55.73 1.82.87.27.14.45.2.51.32.07.11.07.66-.17 1.34z" />
    </svg>
  );
}

interface Action {
  key: string;
  label: string;
  icon: React.ReactNode;
  href?: string;
  external?: boolean;
  onClick?: () => void;
}

interface ContactWidgetProps {
  socialLinks: SocialLink[];
  settings: StoreSettings;
}

/** Single floating entry point for "how do I reach a human" — replaces the old plain WhatsApp-only
 * button with a small expandable menu (WhatsApp / call / feedback), since a store settings admin may
 * configure any subset of those. Fixed-position and mounted once in the storefront layout, so it
 * appears identically on every page for both desktop and mobile; the bottom offset shifts up on
 * mobile to clear the bottom tab bar and, when present, the sticky "view cart" bar.
 *
 * All actions render as matching glossy-white circles differentiated only by icon + label, rather
 * than by brand color (e.g. WhatsApp green) — the brand palette allows exactly one accent color
 * (red, promo labels only), so every other affordance stays monochrome. */
export function ContactWidget({ socialLinks, settings }: ContactWidgetProps) {
  const [open, setOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Product pages can show StickyAddToCart at the bottom on mobile (once the inline buttons scroll
  // out of view) instead of the global StickyCartBar — reserve the same extra clearance for it
  // unconditionally on that route, since this widget can't see the sticky bar's own scroll-driven
  // visibility state. showCartBar already accounts for StickyCartBar hiding itself entirely on
  // /cart and /checkout, so this widget doesn't reserve clearance for a bar that isn't there.
  const { showCartBar, onProductPage } = useBottomDockState();

  // This button is fixed to a viewport corner, and the bottom of the footer (newsletter form,
  // link columns) scrolls into that exact same corner — without this it visually sits on top of
  // and blocks clicks on whatever footer content lands underneath it. Tracked by proximity to the
  // absolute bottom of the page (not "is the footer in view"): the footer can be tall enough that
  // its top edge appears long before its bottom — the actual overlap-prone part — ever does, so
  // hiding as soon as the footer's top peeks in would hide this for a lot of ordinary scrolling
  // that never actually overlaps anything.
  const [nearFooter, setNearFooter] = useState(false);
  useEffect(() => {
    function checkNearBottom() {
      const distanceFromBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      setNearFooter(distanceFromBottom < 180);
    }
    checkNearBottom();
    window.addEventListener("scroll", checkNearBottom, { passive: true });
    window.addEventListener("resize", checkNearBottom);
    return () => {
      window.removeEventListener("scroll", checkNearBottom);
      window.removeEventListener("resize", checkNearBottom);
    };
  }, []);
  useEffect(() => {
    if (nearFooter) setOpen(false);
  }, [nearFooter]);

  const whatsapp = socialLinks.find((l) => l.platform === "WHATSAPP" && l.isActive);

  const actions: Action[] = [];
  if (whatsapp) {
    actions.push({
      key: "whatsapp",
      label: settings.whatsappLabel || "WhatsApp",
      href: withWhatsAppMessage(whatsapp.url, settings.whatsappMessage),
      external: true,
      icon: <WhatsAppGlyph />,
    });
  }
  if (settings.callEnabled && settings.contactPhone) {
    actions.push({
      key: "call",
      label: settings.callLabel || "Call Us",
      href: `tel:${settings.contactPhone}`,
      icon: <Phone size={19} />,
    });
  }
  if (settings.liveChatEnabled && settings.tawkPropertyId && settings.tawkWidgetId) {
    actions.push({
      key: "livechat",
      label: settings.liveChatLabel || "Live Chat",
      icon: <MessageCircleMore size={19} />,
      onClick: () => {
        setOpen(false);
        window.Tawk_API?.toggle?.();
      },
    });
  }
  actions.push({
    key: "feedback",
    label: "Send feedback",
    icon: <MessageSquareText size={19} />,
    onClick: () => {
      setOpen(false);
      setFeedbackOpen(true);
    },
  });

  if (actions.length === 0) return null;

  const bottomClass = onProductPage
    ? "bottom-36 lg:bottom-6"
    : showCartBar
      ? "bottom-36 lg:bottom-24"
      : "bottom-20 lg:bottom-6";

  return (
    <>
      <div
        className={`fixed right-4 z-40 flex flex-col items-end gap-3 transition-[bottom,opacity] duration-200 ease-smooth sm:right-6 ${bottomClass} ${
          nearFooter ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <AnimatePresence>
          {open &&
            actions.map((action, i) => (
              <motion.div
                key={action.key}
                initial={{ opacity: 0, y: 12, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.8 }}
                transition={{ duration: 0.18, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center gap-2"
              >
                <span className="rounded-full bg-ink-900/90 px-2.5 py-1 text-xs text-cream-50 shadow-sm">{action.label}</span>
                {action.href ? (
                  <Link
                    href={action.href}
                    target={action.external ? "_blank" : undefined}
                    rel={action.external ? "noreferrer" : undefined}
                    onClick={() => setOpen(false)}
                    aria-label={action.label}
                    className="glass glossy flex h-11 w-11 items-center justify-center rounded-full text-ink-900 shadow-floatLg transition-transform duration-150 ease-smooth hover:scale-110 active:scale-95"
                  >
                    {action.icon}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={action.onClick}
                    aria-label={action.label}
                    className="glass glossy flex h-11 w-11 items-center justify-center rounded-full text-ink-900 shadow-floatLg transition-transform duration-150 ease-smooth hover:scale-110 active:scale-95"
                  >
                    {action.icon}
                  </button>
                )}
              </motion.div>
            ))}
        </AnimatePresence>

        <motion.button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close contact menu" : "Contact us"}
          aria-expanded={open}
          animate={open ? { scale: 1 } : { scale: [1, 1.05, 1] }}
          transition={open ? { duration: 0.15 } : { duration: 2.4, repeat: 2, repeatDelay: 1, ease: "easeInOut" }}
          className="glass glossy flex h-[52px] w-[52px] items-center justify-center rounded-full text-ink-900 shadow-floatLg"
        >
          <motion.span initial={false} animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
            {open ? <X size={24} /> : <MessageCircle size={24} />}
          </motion.span>
        </motion.button>
      </div>

      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </>
  );
}
