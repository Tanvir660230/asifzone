"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, PackageSearch, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackOrder } from "@/lib/api/orders";
import { StorefrontPage, StorefrontPageHeader } from "@/components/storefront/storefront-page";
import { ApiError } from "@/lib/api-client";
import { sessionSet } from "@/lib/safe-storage";

export default function TrackOrderPage() {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setChecking(true);
    try {
      await trackOrder(orderNumber.trim(), phone);
      sessionSet("lastOrderPhone", phone);
      router.push(`/order-confirmation/${encodeURIComponent(orderNumber.trim())}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not find this order");
      setChecking(false);
    }
  }

  return (
    <StorefrontPage>
      <StorefrontPageHeader breadcrumb={[{ name: "Track your order" }]} title="Track your order" description="Enter your order number and the phone number you ordered with." />
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16">
        <div className="rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="orderNumber">Order number</Label>
              <Input id="orderNumber" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="ORD-20260804-XXXXXX" required />
            </div>
            <div>
              <Label htmlFor="phone">Phone number</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" required />
            </div>
            {error && <p className="text-sm text-danger-600">{error}</p>}
            <Button type="submit" variant="brass" className="w-full" disabled={checking}>
              {checking ? "Checking…" : "Track order"}
            </Button>
          </form>
        </div>
        <aside aria-label="Help with tracking" className="space-y-6 text-sm text-ink-600 lg:pt-2">
          <div className="flex gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-900">
              <PackageSearch size={18} aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium text-ink-900">Where is my order number?</p>
              <p className="mt-0.5">It&rsquo;s in the confirmation you got after ordering, and starts with ORD-.</p>
            </div>
          </div>
          <div className="flex gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-900">
              <UserRound size={18} aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium text-ink-900">Have an account?</p>
              <p className="mt-0.5">
                <Link href="/account/orders" className="font-medium text-ink-900 underline underline-offset-2">
                  Your orders
                </Link>{" "}
                shows every order and where it is, without typing anything.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-900">
              <MessageCircle size={18} aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium text-ink-900">Need a hand?</p>
              <p className="mt-0.5">
                <Link href="/contact" className="font-medium text-ink-900 underline underline-offset-2">
                  Contact us
                </Link>{" "}
                and we&rsquo;ll check it for you.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </StorefrontPage>
  );
}
