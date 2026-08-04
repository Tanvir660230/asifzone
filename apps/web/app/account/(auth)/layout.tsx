import type { ReactNode } from "react";
import Link from "next/link";
import { siteConfig } from "@/lib/site-config";

export default function AccountAuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cream-100 px-4">
      <Link href="/" className="mb-8 font-display text-xl tracking-widest text-ink-900">
        {siteConfig.name.toUpperCase()}
      </Link>
      <div className="w-full max-w-sm rounded-lg bg-cream-50 p-8 shadow-xl">{children}</div>
    </div>
  );
}
