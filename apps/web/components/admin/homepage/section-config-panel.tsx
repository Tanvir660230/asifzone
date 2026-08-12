"use client";

import type { HomepageSectionType } from "@clothing-brand/shared";
import { Modal } from "@/components/ui/modal";
import { SECTION_META } from "./section-meta";
import { ProductCarouselForm } from "./product-carousel-form";
import { PromoBannerForm } from "./promo-banner-form";
import { TrustStripForm } from "./trust-strip-form";
import { ValuesGridForm } from "./values-grid-form";
import { BrandStoryForm } from "./brand-story-form";
import { HeadingOnlyForm } from "./heading-only-form";

interface SectionConfigPanelProps {
  type: HomepageSectionType;
  initialConfig: Record<string, unknown>;
  onSubmit: (config: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export function SectionConfigPanel({ type, initialConfig, onSubmit, onClose }: SectionConfigPanelProps) {
  const meta = SECTION_META[type];
  const formProps = { initialConfig, onSubmit, onCancel: onClose };

  return (
    <Modal open onClose={onClose} title={`Edit ${meta.label}`}>
      {type === "PRODUCT_CAROUSEL" && <ProductCarouselForm {...formProps} />}
      {type === "PROMO_BANNER" && <PromoBannerForm {...formProps} />}
      {type === "TRUST_STRIP" && <TrustStripForm {...formProps} />}
      {type === "VALUES_GRID" && <ValuesGridForm {...formProps} />}
      {type === "BRAND_STORY" && <BrandStoryForm {...formProps} />}
      {type === "CATEGORY_GRID" && <HeadingOnlyForm {...formProps} />}
    </Modal>
  );
}
