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
