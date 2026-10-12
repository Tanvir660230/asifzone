import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getSiteUrl } from "@/lib/seo";

// The page is a client component, so its metadata lives here. A public utility page: indexable, canonical to itself.
export function generateMetadata(): Metadata {
  return {
    title: "Track your order",
    description: "Check the status of your order with its order number and phone number.",
    alternates: { canonical: `${getSiteUrl()}/track-order` },
  };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
