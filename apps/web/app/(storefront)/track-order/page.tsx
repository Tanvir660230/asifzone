"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackOrder } from "@/lib/api/orders";
import { ApiError } from "@/lib/api-client";

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
      sessionStorage.setItem("lastOrderPhone", phone);
      router.push(`/order-confirmation/${encodeURIComponent(orderNumber.trim())}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not find this order");
      setChecking(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-24 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-ink-100 bg-cream-50 p-8">
        <span className="glossy mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-brass-100 text-brass-600">
          <PackageSearch size={20} />
        </span>
        <h1 className="mb-2 font-display text-2xl text-ink-900">Track your order</h1>
        <p className="mb-6 text-sm text-ink-500">Enter your order number and phone to check its status.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="orderNumber">Order number</Label>
            <Input
              id="orderNumber"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="ORD-20260804-XXXX"
              required
            />
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
    </div>
  );
}
