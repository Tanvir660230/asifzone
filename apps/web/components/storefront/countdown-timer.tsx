"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function getRemaining(endsAt: string) {
  const diff = Math.max(0, new Date(endsAt).getTime() - Date.now());
  return {
    hours: Math.floor(diff / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
    seconds: Math.floor((diff % 60_000) / 1_000),
    expired: diff <= 0,
  };
}

export function CountdownTimer({ endsAt, className }: { endsAt: string; className?: string }) {
  // Computing the initial value during SSR would embed the server's clock reading in the
  // HTML; the client then computes a different reading at hydration time and React flags
  // a mismatch. So the real value is only ever computed client-side, after mount.
  const [remaining, setRemaining] = useState<ReturnType<typeof getRemaining> | null>(null);

  useEffect(() => {
    setRemaining(getRemaining(endsAt));
    const interval = setInterval(() => setRemaining(getRemaining(endsAt)), 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  if (remaining?.expired) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  // Same "--:--:--" width as a real reading, pre-mount — avoids a layout shift once the
  // client value replaces it (tabular-nums keeps digit widths from jittering after that).
  const text = remaining ? `${pad(remaining.hours)}:${pad(remaining.minutes)}:${pad(remaining.seconds)}` : "--:--:--";

  return <span className={cn(className, "tabular-nums")}>{text}</span>;
}
