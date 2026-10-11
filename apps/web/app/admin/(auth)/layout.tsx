import type { ReactNode } from "react";
import Link from "next/link";
import { getSiteSettings } from "@/lib/api/storefront";
import { StoreLogoImage } from "@/components/store-logo-image";
import { resolveImageUrl } from "@/lib/image-url";

// Session-aware pages, must always be live — never cached or statically served.
export const dynamic = "force-dynamic";

/** Sign-in and invite pages: the Store Console surface (light, one centred card), the store's own logo above it. */
export default async function AdminAuthLayout({ children }: { children: ReactNode }) {
  const { settings } = await getSiteSettings();
  // The canvas is light, so the light-background logo comes first.
  const logoUrl = settings.logoUrl ?? settings.logoOnDarkUrl;
  const wordmark = <span className="text-xl font-semibold tracking-tight text-fg">{settings.storeName}</span>;

  return (
    <div data-surface="admin" className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12 font-sans text-fg">
      <div className="w-full max-w-[400px]">
        <Link href="/" aria-label={`${settings.storeName} home`} className="mx-auto mb-8 flex w-fit items-center">
          {logoUrl ? <StoreLogoImage src={resolveImageUrl(logoUrl)} alt={settings.storeName} className="h-10 w-36 object-contain" fallback={wordmark} /> : wordmark}
        </Link>
        <div className="rounded-2xl border border-line bg-surface p-8 shadow-lg sm:p-10">{children}</div>
        <p className="mt-6 text-center text-xs text-fg-subtle">{settings.storeName} · Store Console</p>
      </div>
    </div>
  );
}
