import type { ReactNode } from "react";
import { Noto_Sans_Bengali } from "next/font/google";
import { Toaster } from "@/components/ui/toast";

// The landing pages are written in Bangla, so here the Bengali face is preloaded (the root layout only loads it on
// demand). Same font and options as the root's, re-declared so the preload applies to these pages alone.
const notoSansBengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  variable: "--font-bn",
  display: "swap",
  weight: "variable",
});

// Product landing pages (/lp/[slug]) — the page an ad links to. Deliberately not inside StorefrontShell: no menu, bag,
// search or bottom tab bar to wander off into; the page brings its own slim header and footer. Root layout still
// provides the theme, fonts, consent banner and ad pixels.
export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`flex min-h-screen flex-col bg-canvas ${notoSansBengali.variable}`}>
      {children}
      <Toaster />
    </div>
  );
}
