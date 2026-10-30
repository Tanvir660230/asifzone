import Link from "next/link";
import { MessageCircle, PackageSearch, Truck } from "lucide-react";

const LINKS = [
  { href: "/contact", icon: MessageCircle, title: "Contact us", text: "Order questions, sizing, anything else." },
  { href: "/track-order", icon: PackageSearch, title: "Track your order", text: "Where your parcel is right now." },
  { href: "/shipping-returns", icon: Truck, title: "Shipping & returns", text: "Delivery times, fees and how to return." },
];

/** "Still need help?" beside a help page's content on wide screens (pinned while the content scrolls): the three places
 * a shopper goes next. */
export function HelpAside() {
  return (
    <aside aria-label="More help" className="rounded-2xl bg-surface p-5 ring-1 ring-inset ring-line-subtle lg:sticky lg:top-[calc(var(--sticky-top)+1.5rem)]">
      <p className="font-medium text-ink-900">Still need help?</p>
      <ul className="mt-4 space-y-1">
        {LINKS.map(({ href, icon: Icon, title, text }) => (
          <li key={href}>
            <Link href={href} className="-mx-2 flex gap-3 rounded-xl p-2 transition-colors hover:bg-surface-muted">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-900">
                <Icon size={16} aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-medium text-ink-900">{title}</span>
                <span className="block text-xs text-ink-500">{text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
