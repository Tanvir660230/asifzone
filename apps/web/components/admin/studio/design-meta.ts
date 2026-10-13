import { Megaphone, PanelBottom, PanelTop, Palette, type LucideIcon } from "lucide-react";
import type { StorefrontDesignGroup } from "@clothing-brand/shared";

/** The Studio's "Site design" groups. Their selection ids are `design:<group>` (the preview tags the chrome with them). */
export const DESIGN_GROUPS: StorefrontDesignGroup[] = ["theme", "announcement", "header", "footer"];

export const DESIGN_META: Record<StorefrontDesignGroup, { label: string; description: string; icon: LucideIcon }> = {
  theme: { label: "Colours & type", description: "Your brand colour, fonts, corners and spacing — across every page.", icon: Palette },
  announcement: { label: "Announcement bar", description: "A thin strip above the header for offers and news.", icon: Megaphone },
  header: { label: "Header", description: "Extra links in the main menu, before your categories.", icon: PanelTop },
  footer: { label: "Footer", description: "The line about your store, an extra links column and the newsletter.", icon: PanelBottom },
};

export const designSelectionId = (group: StorefrontDesignGroup) => `design:${group}`;

export function designGroupOf(id: string | null): StorefrontDesignGroup | null {
  if (!id?.startsWith("design:")) return null;
  const group = id.slice("design:".length) as StorefrontDesignGroup;
  return DESIGN_GROUPS.includes(group) ? group : null;
}
