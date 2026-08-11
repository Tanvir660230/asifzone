import type { ReactNode } from "react";
import Link from "next/link";
import { getSiteSettings } from "@/lib/api/storefront";
import { StoreLogoImage } from "@/components/store-logo-image";

// Session-aware pages, must always be live — never cached or statically served.
export const dynamic = "force-dynamic";

export default async function AccountAuthLayout({ children }: { children: ReactNode }) {
  const { settings } = await getSiteSettings();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cream-100 px-4 py-12">
      <Link
        href="/"
        aria-label={`${settings.storeName} home`}
        className="mb-8 flex items-center transition-transform duration-200 ease-smooth hover:scale-[1.02]"
      >
        {settings.logoUrl ? (
          <StoreLogoImage
            src={settings.logoUrl}
            alt={settings.storeName}
            className="h-10 w-auto object-contain"
            fallback={
              <span className="font-display text-2xl font-semibold tracking-[0.2em] text-ink-900">
                {settings.storeName.toUpperCase()}
              </span>
            }
          />
        ) : (
          <span className="font-display text-2xl font-semibold tracking-[0.2em] text-ink-900">
            {settings.storeName.toUpperCase()}
          </span>
        )}
      </Link>
      <div className="w-full max-w-sm rounded-2xl border border-ink-100 bg-cream-50 p-8 shadow-lg">{children}</div>
    </div>
  );
}
