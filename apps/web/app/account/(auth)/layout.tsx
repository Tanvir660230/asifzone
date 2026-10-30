import type { ReactNode } from "react";
import { Bell, Heart, MapPin, Package, Star } from "lucide-react";
import { StorefrontShell } from "@/components/storefront/storefront-shell";
import { StorefrontPage } from "@/components/storefront/storefront-page";

// Session-aware pages, must always be live — never cached or statically served.
export const dynamic = "force-dynamic";

// What an account gives a shopper — each one a feature the store really has.
const BENEFITS = [
  { icon: Package, title: "Track every order", text: "See where each order is and reorder in one tap." },
  { icon: MapPin, title: "Faster checkout", text: "Your saved addresses fill in the delivery details for you." },
  { icon: Heart, title: "Wishlist on every device", text: "Save what you like and find it on your phone or laptop." },
  { icon: Bell, title: "Back-in-stock alerts", text: "Get an email when a sold-out size is back." },
  { icon: Star, title: "Reward points", text: "Earn points on delivered orders." },
];

/** Sign in, register, password and email pages: inside the regular storefront (header, footer, bag), in the same page
 * frame as every other page — the form in a card on the left, and on wide screens what an account is for beside it. */
export default function AccountAuthLayout({ children }: { children: ReactNode }) {
  return (
    <StorefrontShell>
      <StorefrontPage>
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16">
          <div className="rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-8">{children}</div>
          <aside aria-label="Why have an account" className="hidden lg:block lg:pt-6">
            <p className="text-xs ui-eyebrow text-fg-muted">Your account</p>
            <ul className="mt-6 space-y-6">
              {BENEFITS.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-4">
                  <span className="flex h-[var(--icon-chip-size,2.5rem)] w-[var(--icon-chip-size,2.5rem)] shrink-0 items-center justify-center rounded-full bg-[color:var(--icon-chip-bg,rgb(var(--color-surface-muted)))] text-ink-900">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-medium text-ink-900">{title}</p>
                    <p className="mt-0.5 text-sm text-ink-500">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </StorefrontPage>
    </StorefrontShell>
  );
}
