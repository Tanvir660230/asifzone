"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { HomepageSectionType } from "@clothing-brand/shared";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toDatetimeLocalValue } from "@/lib/datetime-local";
import { SECTION_META } from "./section-meta";
import { SectionPreview } from "./section-preview";
import { ProductCarouselForm } from "./product-carousel-form";
import { PromoBannerForm } from "./promo-banner-form";
import { TrustStripForm } from "./trust-strip-form";
import { ValuesGridForm } from "./values-grid-form";
import { BrandStoryForm } from "./brand-story-form";
import { HeadingOnlyForm } from "./heading-only-form";
import { HeroForm } from "./hero-form";
import { PersonalizedLeadForm } from "./personalized-lead-form";
import { SmartRecommendationsForm } from "./smart-recommendations-form";

export interface SectionSavePayload {
  config: Record<string, unknown>;
  startsAt: string | null;
  endsAt: string | null;
}

interface SectionConfigPanelProps {
  type: HomepageSectionType;
  initialConfig: Record<string, unknown>;
  initialStartsAt?: string | null;
  initialEndsAt?: string | null;
  onSubmit: (payload: SectionSavePayload) => Promise<void>;
  onClose: () => void;
}

export function SectionConfigPanel({
  type,
  initialConfig,
  initialStartsAt,
  initialEndsAt,
  onSubmit,
  onClose,
}: SectionConfigPanelProps) {
  const meta = SECTION_META[type];
  const [startsAt, setStartsAt] = useState(() => toDatetimeLocalValue(initialStartsAt));
  const [endsAt, setEndsAt] = useState(() => toDatetimeLocalValue(initialEndsAt));
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>(initialConfig);

  async function handleChildSubmit(config: Record<string, unknown>) {
    await onSubmit({ config, startsAt: startsAt || null, endsAt: endsAt || null });
  }

  const formProps = { initialConfig, onSubmit: handleChildSubmit, onCancel: onClose, onValuesChange: setPreviewValues };

  return (
    <Modal open onClose={onClose} title={`Edit ${meta.label}`} widthClassName="max-w-5xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-xs text-ink-500">{meta.description}</p>
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-brass-600 hover:underline"
        >
          View live homepage <ExternalLink size={12} />
        </a>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg border border-ink-100 bg-cream-50 p-3">
        <div>
          <Label htmlFor="section-starts-at">Visible from (optional)</Label>
          <Input id="section-starts-at" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="section-ends-at">Visible until (optional)</Label>
          <Input id="section-ends-at" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          {type === "PRODUCT_CAROUSEL" && <ProductCarouselForm {...formProps} />}
          {type === "PROMO_BANNER" && <PromoBannerForm {...formProps} />}
          {type === "TRUST_STRIP" && <TrustStripForm {...formProps} />}
          {type === "VALUES_GRID" && <ValuesGridForm {...formProps} />}
          {type === "BRAND_STORY" && <BrandStoryForm {...formProps} />}
          {type === "CATEGORY_GRID" && <HeadingOnlyForm {...formProps} />}
          {type === "HERO" && <HeroForm {...formProps} />}
          {type === "PERSONALIZED_LEAD" && <PersonalizedLeadForm {...formProps} />}
          {type === "SMART_RECOMMENDATIONS" && <SmartRecommendationsForm {...formProps} />}
        </div>
        <div className="hidden lg:block">
          <SectionPreview type={type} values={previewValues} />
        </div>
      </div>
    </Modal>
  );
}
