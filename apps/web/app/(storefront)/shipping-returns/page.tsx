import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Shipping & Returns",
  description: "Delivery timelines, shipping fees, and our return & exchange policy.",
  alternates: { canonical: `${getSiteUrl()}/shipping-returns` },
};

export default function ShippingReturnsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="mb-8 font-display text-3xl text-ink-900">Shipping &amp; Returns</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-brass-500">Shipping</h2>
        <div className="space-y-3 text-sm leading-relaxed text-ink-700">
          <p>Orders are processed within 1–2 business days and dispatched via courier nationwide.</p>
          <p>Inside Dhaka: 1–2 business days. Outside Dhaka: 3–5 business days.</p>
          <p>Cash on Delivery is available on every order — pay when your parcel arrives at your door.</p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-brass-500">Returns &amp; Exchanges</h2>
        <div className="space-y-3 text-sm leading-relaxed text-ink-700">
          <p>Unworn items in original condition with tags attached can be returned or exchanged within 7 days of delivery.</p>
          <p>
            To start a return, get in touch via the{" "}
            <a href="/contact" className="text-ink-900 underline underline-offset-2 hover:text-brass-500">
              contact page
            </a>{" "}
            with your order number.
          </p>
          <p>Items marked final sale are not eligible for return.</p>
        </div>
      </section>
    </div>
  );
}
