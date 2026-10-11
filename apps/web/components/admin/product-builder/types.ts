import type { CompletenessCheckKey, ProductStatus, WizardStepId } from "@clothing-brand/shared";
import type { ProductFormState } from "@/components/admin/product-form-state";
import type { StagedImage } from "@/components/admin/image-uploader";

/** The shared form state plus the wizard-only pieces. `stagedImages`/`onStagedChange` only matter
 * before the product exists (the "new" wizard's Basics/Media/Pricing phase) — once `initial` is set
 * (the "edit" wizard, after creation), Media/Variants work against the real, saved images instead,
 * the same two-phase split the existing "new product" page already relies on. */
export interface WizardState extends ProductFormState {
  stagedImages: StagedImage[];
  onStagedChange: (next: StagedImage[]) => void;
}

/** What the Final Review, Publish and SEO steps can ask the wizard to do. */
export interface WizardActions {
  /** Jump to the step that fixes a completeness check. */
  fix: (key: CompletenessCheckKey) => void;
  goTo: (id: WizardStepId) => void;
  /** Save now (and move to `status` when given) — the same action as the status panel's buttons. */
  saveWithStatus: (status?: ProductStatus) => Promise<boolean>;
  busy: boolean;
  /** Set once a publish from the Publish step succeeds, so it can say so. */
  justPublished: boolean;
  /** A live product's URL only changes when confirmed — this is that confirmation. */
  applySlug: (slug: string) => Promise<void>;
  applyingSlug: boolean;
}
