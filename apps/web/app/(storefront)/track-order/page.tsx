"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function TrackOrderPage() {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sessionStorage.setItem("lastOrderPhone", phone);
    router.push(`/order-confirmation/${encodeURIComponent(orderNumber.trim())}`);
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-24 sm:px-6 lg:px-8">
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
        <Button type="submit" variant="brass" className="w-full">
          Track order
        </Button>
      </form>
    </div>
  );
}
