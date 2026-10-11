"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, MessageCircleMore, MessageSquareText, Phone, X } from "lucide-react";
import type { SocialLink, StoreSettings } from "@clothing-brand/shared";
import { pixelContact } from "@/lib/pixels";
import { withWhatsAppMessage } from "@/lib/whatsapp";

declare global {
  interface Window {
    Tawk_API?: { toggle?: () => void };
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
  const { showCartBar, onProductPage, onCheckoutPage } = useBottomDockState();

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
  // The fixed corner this button occupies isn't exclusively ours: ProductCard's own quick-add
  // button (marked `data-fab-collision`) sits at its card's bottom-right corner too, and product
  // carousels (Trending/Recently Viewed etc.) scroll horizontally on their own — shifting this
  // button sideways (see the right-20 note below) fully separates the two on a static grid, but a
  // carousel card can still slide to any x position, including right under us. Rather than chase
  // every layout, just watch for actual overlap and duck out of the way when it happens.
  const widgetRef = useRef<HTMLDivElement>(null);
  // Overlap is measured against the round button only: the open menu grows upward and would otherwise "collide" with a
  // card below it and close itself the moment it opened.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [overlappingCard, setOverlappingCard] = useState(false);
  useEffect(() => {
    let raf = 0;
    function checkOverlap() {
      raf = 0;
      const toggle = toggleRef.current;
      if (!toggle) return;
      const widgetBox = toggle.getBoundingClientRect();
      const cardButtons = document.querySelectorAll<HTMLElement>("[data-fab-collision]");
      let overlaps = false;
      for (const el of cardButtons) {
        const box = el.getBoundingClientRect();
        if (box.left < widgetBox.right && box.right > widgetBox.left && box.top < widgetBox.bottom && box.bottom > widgetBox.top) {
          overlaps = true;
          break;
        }
      }
      setOverlappingCard(overlaps);
    }
    function scheduleCheck() {
      if (!raf) raf = requestAnimationFrame(checkOverlap);
    }
    checkOverlap();
    // capture: true — a carousel's own scroll happens inside its `overflow-x-auto` container, and
    // scroll events don't bubble, but they do fire on ancestors during the capture phase, so this
    // one listener catches both the page scrolling and any carousel scrolling independently of it.
    document.addEventListener("scroll", scheduleCheck, { passive: true, capture: true });
    window.addEventListener("resize", scheduleCheck);
    // A marked control can also appear without any scroll (e.g. "Notify me" after picking a sold-out size).
    const mutations = new MutationObserver((records) => {
      // The widget's own menu opening/closing is not a reason to re-check.
      if (records.every((r) => widgetRef.current?.contains(r.target))) return;
      scheduleCheck();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      document.removeEventListener("scroll", scheduleCheck, { capture: true });
      window.removeEventListener("resize", scheduleCheck);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Only a closed button ducks out of the way; an open menu stays open until the shopper closes it.
  const shouldHide = !open && (nearFooter || overlappingCard);
  // An open menu closes on a tap outside it or Escape, like any menu.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!widgetRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  // Checkout is a focused page: no floating button over the form.
  if (actions.length === 0 || onCheckoutPage) return null;

  // Above the mobile bottom nav; above the sticky cart bar while it shows; and on a product page above the sticky
  // add-to-cart bar only while that bar is on screen (it marks <html data-sticky-atc>), not from the top of the page.
  const bottomClass = onProductPage
    ? "bottom-20 lg:bottom-6 [html[data-sticky-atc]_&]:bottom-36 lg:[html[data-sticky-atc]_&]:bottom-6"
    : showCartBar
      ? "bottom-36 lg:bottom-24"
      : "bottom-20 lg:bottom-6";

  return (
    <>
      {/* Flush to the right edge, in the gutter corner every shop uses. It used to sit at right-20 to dodge the product
          cards' quick-add buttons, which put it over the middle of the content on phones (product titles, checkout
          fields); the overlap check above already ducks it out of the way of a quick-add button that scrolls under it.
          Hidden while the on-screen keyboard is open. */}
      <div
        ref={widgetRef}
        data-hide-on-keyboard
        className={`fixed right-4 z-40 flex flex-col items-end gap-3 transition-[bottom,opacity] duration-200 ease-smooth sm:right-6 ${bottomClass} ${
          shouldHide ? "pointer-events-none opacity-0" : "opacity-100"
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
                    onClick={() => {
                      setOpen(false);
                      // Opening WhatsApp / dialing is the contact itself — there's no later
                      // "sent" signal to wait for from either app.
                      if (action.key === "whatsapp" || action.key === "call") pixelContact(action.key);
                    }}
                    aria-label={action.label}
                    className="glass glossy flex h-10 w-10 items-center justify-center rounded-full text-ink-900 shadow-floatLg transition-transform duration-150 ease-smooth hover:scale-110 active:scale-95"
                  >
                    {action.icon}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={action.onClick}
                    aria-label={action.label}
                    className="glass glossy flex h-10 w-10 items-center justify-center rounded-full text-ink-900 shadow-floatLg transition-transform duration-150 ease-smooth hover:scale-110 active:scale-95"
                  >
                    {action.icon}
                  </button>
                )}
              </motion.div>
            ))}
        </AnimatePresence>

        <motion.button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close contact menu" : "Contact us"}
          aria-expanded={open}
          animate={open ? { scale: 1 } : { scale: [1, 1.05, 1] }}
          transition={open ? { duration: 0.15 } : { duration: 2.4, repeat: 2, repeatDelay: 1, ease: "easeInOut" }}
          className="glass glossy flex h-11 w-11 items-center justify-center rounded-full text-ink-900 shadow-floatLg"
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
