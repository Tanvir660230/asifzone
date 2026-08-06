import type { ReactNode } from "react";
import Link from "next/link";
import { getSiteSettings } from "@/lib/api/storefront";

// Session-aware pages, must always be live — never cached or statically served.
export const dynamic = "force-dynamic";

export default async function AccountAuthLayout({ children }: { children: ReactNode }) {
  const { settings } = await getSiteSettings();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cream-100 px-4">
      <Link href="/" className="mb-8 font-display text-xl tracking-widest text-ink-900">
        {settings.storeName.toUpperCase()}
      </Link>
      <div className="w-full max-w-sm rounded-lg bg-cream-50 p-8 shadow-xl">{children}</div>
    </div>
  );
}
