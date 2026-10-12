import type { ReactNode } from "react";
import { privatePageMetadata } from "@/lib/seo";

// The page is a client component, so its metadata lives here: a real title, kept out of search results.
export const metadata = privatePageMetadata("Create an account");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
