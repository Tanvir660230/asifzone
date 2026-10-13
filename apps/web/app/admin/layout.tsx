import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchAdminSession } from "@/lib/admin/session-prefetch";

export const metadata: Metadata = {
  title: "Store Console",
  // robots.txt already disallows /admin, but that only stops crawling — it can't stop a URL
  // that's discovered some other way (an inbound link, a screenshot) from getting indexed with a
  // bare "no description available" listing. noindex is the actual guarantee.
  robots: { index: false, follow: false },
  // Saved to an iPhone's home screen, the console opens full screen like an app, under its own name.
  appleWebApp: { capable: true, title: "Store Console", statusBarStyle: "default" },
};

// viewport-fit=cover: the page runs edge to edge on notched phones, so env(safe-area-inset-*) reports the home
// indicator and the tab bar sits above it (components/admin/sidebar.tsx MobileBottomNav).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Admin must always be live/session-aware, never cached or statically served.
export const dynamic = "force-dynamic";

// The signed-in admin and provider capabilities arrive with the page (lib/admin/session-prefetch.ts), so permission-gated
// queries start on hydration instead of one round trip later.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await prefetchAdminSession();
  return session ? <HydrationBoundary state={session}>{children}</HydrationBoundary> : children;
}
