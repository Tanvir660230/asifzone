import type { ComponentProps } from "react";
import { storeLayout } from "@/lib/theme-layout";
import { Header } from "./header";
import { Footer } from "./footer";
import { HoneyHeader } from "./presets/honey/header";
import { HoneyFooter } from "./presets/honey/footer";
import { TahafiHeader } from "./presets/tahafi/header";
import { TahafiDock } from "./presets/tahafi/dock";
import { TahafiFooter } from "./presets/tahafi/footer";
import { MobileBottomNav } from "./mobile-bottom-nav";

/** The store's header and footer in the theme's structural preset (lib/theme-layout.ts) — every page shell renders these,
 * never `Header`/`Footer` directly, so a preset reaches the account area as well as the shop. */
export function StoreHeader(props: ComponentProps<typeof Header>) {
  const layout = storeLayout();
  if (layout === "honey") return <HoneyHeader {...props} />;
  if (layout === "tahafi") return <TahafiHeader {...props} />;
  return <Header {...props} />;
}

export function StoreFooter(props: ComponentProps<typeof Footer>) {
  const layout = storeLayout();
  if (layout === "honey") return <HoneyFooter {...props} />;
  if (layout === "tahafi") return <TahafiFooter {...props} />;
  return <Footer {...props} />;
}

/** The phone tab bar in the theme's preset. */
export function StoreDock() {
  return storeLayout() === "classic" ? <MobileBottomNav /> : <TahafiDock />;
}
