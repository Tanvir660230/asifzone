import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Store Console",
  // robots.txt already disallows /admin, but that only stops crawling — it can't stop a URL
  // that's discovered some other way (an inbound link, a screenshot) from getting indexed with a
  // bare "no description available" listing. noindex is the actual guarantee.
  robots: { index: false, follow: false },
};

// Admin must always be live/session-aware, never cached or statically served.
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
