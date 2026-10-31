import type { ComponentProps } from "react";
import { storeLayout } from "@/lib/theme-layout";
import { Header } from "./header";
import { Footer } from "./footer";
import { MihrabHeader } from "./presets/mihrab/header";
import { MihrabFooter } from "./presets/mihrab/footer";
import { TahafiHeader } from "./presets/tahafi/header";
import { TahafiDock } from "./presets/tahafi/dock";
import { MobileBottomNav } from "./mobile-bottom-nav";

/** The store's header and footer in the theme's structural preset (lib/theme-layout.ts) — every page shell renders these,
 * never `Header`/`Footer` directly, so a preset reaches the account area as well as the shop. */
export function StoreHeader(props: ComponentProps<typeof Header>) {
  const layout = storeLayout();
  if (layout === "mihrab") return <MihrabHeader {...props} />;
  if (layout === "tahafi") return <TahafiHeader {...props} />;
  return <Header {...props} />;
}

export function StoreFooter(props: ComponentProps<typeof Footer>) {
  return storeLayout() === "mihrab" ? <MihrabFooter {...props} /> : <Footer {...props} />;
}

/** The phone tab bar in the theme's preset. */
export function StoreDock() {
  return storeLayout() === "tahafi" ? <TahafiDock /> : <MobileBottomNav />;
}
