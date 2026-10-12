import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toast";

// Product landing pages (/lp/[slug]) — the page an ad links to. Deliberately not inside StorefrontShell: no menu, bag,
// search or bottom tab bar to wander off into; the page brings its own slim header and footer. Root layout still
// provides the theme, fonts, consent banner and ad pixels.
export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {children}
      <Toaster />
    </div>
  );
}
