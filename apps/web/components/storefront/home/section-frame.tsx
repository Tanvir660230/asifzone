import type { ReactNode } from "react";
import type { SectionAppearance } from "@clothing-brand/shared";

/** The wrapper around every homepage section. It carries the section's own appearance as data attributes, read by the
 * `.ui-section-frame` recipes in globals.css (spacing scales the theme's rhythm, muted background, desktop- or
 * mobile-only), and its id, which the Storefront Studio preview uses to outline and select it. */
export function SectionFrame({ id, appearance, children }: { id: string; appearance?: SectionAppearance; children: ReactNode }) {
  const spacing = appearance?.spacing && appearance.spacing !== "default" ? appearance.spacing : undefined;
  const showOn = appearance?.showOn && appearance.showOn !== "all" ? appearance.showOn : undefined;
  const background = appearance?.background === "muted" ? "muted" : undefined;
  return (
    <div className="ui-section-frame" data-section-id={id} data-spacing={spacing} data-show={showOn} data-background={background}>
      {children}
    </div>
  );
}
