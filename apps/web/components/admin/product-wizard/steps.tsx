"use client";

import { Controller } from "react-hook-form";
import Link from "next/link";
import type { SectionOverrideInput } from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/admin/form-section";
import { VariantEditor } from "@/components/admin/variant-editor";
import { SizeGuideEditor } from "@/components/admin/size-guide-editor";
import { AttributeFields } from "@/components/admin/attribute-fields";
import { CareMaterialSection } from "@/components/admin/care-material-section";
import { SectionSettingsEditor, layerOf } from "@/components/admin/section-settings-editor";
import { FaqEditor, RelatedProductsEditor } from "@/components/admin/product-content-editors";
import { ImageUploader } from "@/components/admin/image-uploader";
import { AiGenerateButton } from "@/components/admin/product-form";
import { buildCategoryOptions } from "@/components/admin/product-form-state";
import type { WizardState } from "./types";
import * as aiApi from "@/lib/api/ai";
import { stripHtml } from "@/lib/format";
import { cn } from "@/lib/utils";
import { slugify, type Category } from "@clothing-brand/shared";

/** Every step pane needs the shared form state; most add a couple of step-specific props on top. */
interface StepProps {
  state: WizardState;
}

export function BasicsStep({ state, categories }: StepProps & { categories: Category[] }) {
  const { form, selectedConfig, canUseAi, initial, typeId, types } = state;
  const { register, control, watch, setValue, formState: { errors } } = form;
  const categoryOptions = buildCategoryOptions(categories);
  const productName = watch("name");
  const aiContext = { productName: productName || undefined, category: categories.find((c) => c.id === watch("categoryId"))?.name, brand: watch("brand") ?? undefined };

  return (
    <>
      <FormSection title="Basics" description="What this product is — the customer never sees this step directly, but everything else builds on it.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">Product name</Label>
            <Input id="name" {...register("name")} />
            {errors.name && <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>}
          </div>

          <div>
            <Label htmlFor="categoryId">Category</Label>
            <Select id="categoryId" {...register("categoryId")}>
              <option value="">Select a category…</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
            {errors.categoryId && <p className="mt-1 text-xs text-danger-600">{errors.categoryId.message}</p>}
          </div>

          <div>
            <Label htmlFor="typeId">Product type</Label>
            <Controller
              control={control}
              name="typeId"
              render={({ field }) => (
                <Select id="typeId" ref={field.ref} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur}>
                  {types.length === 0 && <option value="">Loading types…</option>}
                  {types
                    .filter((t) => t.isActive || t.typeId === typeId)
                    .map((t) => (
                      <option key={t.typeId} value={t.typeId}>
                        {t.name}
                        {t.isActive ? "" : " (archived)"}
                      </option>
                    ))}
                </Select>
              )}
            />
            {selectedConfig?.description && <p className="mt-1 text-xs text-ink-400">{selectedConfig.description}</p>}
            {initial && typeId && typeId !== initial.typeId && (
              <p className="mt-1 text-xs text-brass-700">
                Changing the type changes which fields (and which later steps) appear. Values the new type doesn&rsquo;t use are kept and come back if you switch back.
              </p>
            )}
            {errors.typeId && <p className="mt-1 text-xs text-danger-600">{errors.typeId.message}</p>}
          </div>

          <div>
            <Label htmlFor="brand">Brand</Label>
            <Input id="brand" placeholder="e.g. Asif Zone Originals" {...register("brand")} />
          </div>

          <div>
            <Label htmlFor="brandTier">Tier</Label>
            <Select id="brandTier" {...register("brandTier")}>
              <option value="PREMIUM">Premium</option>
              <option value="PLATINUM">Platinum</option>
              <option value="LUXURY">Luxury</option>
            </Select>
          </div>

          <div className="flex items-end gap-6 pb-2">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <Checkbox {...register("isFeatured")} />
              Featured
            </label>
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="shortDescription">Short description</Label>
            <Textarea id="shortDescription" rows={2} placeholder="One or two lines shown in listings and previews" {...register("shortDescription")} />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>Description</Label>
            {canUseAi && (
              <AiGenerateButton
                disabled={!productName}
                onGenerate={async () => {
                  const { text } = await aiApi.generateAiContent({ type: "product_description", ...aiContext });
                  setValue("description", text.split(/\n{2,}/).map((p) => `<p>${p.trim()}</p>`).join(""), { shouldDirty: true });
                  return text;
                }}
              />
            )}
          </div>
          <Controller control={control} name="description" render={({ field }) => <BasicsDescriptionEditor value={field.value ?? ""} onChange={field.onChange} />} />
        </div>
      </FormSection>

      {selectedConfig && (
        <AttributeFields
          fields={selectedConfig.fields}
          control={control}
          errors={errors}
          title={`${selectedConfig.name} details`}
          description={selectedConfig.description ?? undefined}
        />
      )}
    </>
  );
}

// Tiptap is large and admin-only — lazy-load it the same way product-form.tsx does, without pulling
// next/dynamic into every step file.
import dynamic from "next/dynamic";
import { uploadEditorImage } from "@/lib/api/uploads";
const RichTextEditor = dynamic(() => import("@/components/admin/rich-text-editor").then((m) => m.RichTextEditor), { ssr: false });
function BasicsDescriptionEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <RichTextEditor value={value} onChange={onChange} uploadImage={uploadEditorImage} />;
}

export function MediaStep({ state }: StepProps) {
  const { initial, stagedImages, onStagedChange } = state;
  return (
    <FormSection title="Media" description="Photos customers will see. The first one is the cover image.">
      <ImageUploader productId={initial?.id} images={initial?.images} staged={initial ? undefined : stagedImages} onStagedChange={onStagedChange} />
    </FormSection>
  );
}

export function PricingStep({ state }: StepProps) {
  const { form, initial } = state;
  const { register, formState: { errors } } = form;
  const basePrice = form.watch("basePrice");
  const costPrice = form.watch("costPrice");
  const margin = basePrice && costPrice && basePrice > 0 ? (((basePrice - costPrice) / basePrice) * 100).toFixed(1) : null;

  return (
    <>
      <FormSection title="Pricing & tax">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="basePrice">Base price (BDT)</Label>
            <Input id="basePrice" type="number" step="0.01" {...register("basePrice", { valueAsNumber: true })} />
            {errors.basePrice && <p className="mt-1 text-xs text-danger-600">{errors.basePrice.message}</p>}
          </div>
          <div>
            <Label htmlFor="compareAtPrice">Compare-at price</Label>
            <Input id="compareAtPrice" type="number" step="0.01" placeholder="Optional" {...register("compareAtPrice", { valueAsNumber: true })} />
          </div>
          <div>
            <Label htmlFor="costPrice">Cost price</Label>
            <Input id="costPrice" type="number" step="0.01" placeholder="Optional" {...register("costPrice", { valueAsNumber: true })} />
          </div>
          <div>
            <Label htmlFor="taxRate">Tax rate (%)</Label>
            <Input id="taxRate" type="number" step="0.01" placeholder="Optional" {...register("taxRate", { valueAsNumber: true })} />
          </div>
        </div>
        {margin && (
          <p className="text-xs text-ink-500">
            Estimated margin at base price: <span className="font-medium text-ink-800">{margin}%</span>
          </p>
        )}
      </FormSection>

      <FormSection title="Inventory" description="Controls stock tracking and the low-stock warning threshold.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 pt-6 text-sm text-ink-700">
            <Checkbox {...register("trackInventory")} />
            Track inventory for this product
          </label>
          <div>
            <Label htmlFor="lowStockThreshold">Low stock threshold</Label>
            <Input id="lowStockThreshold" type="number" {...register("lowStockThreshold", { valueAsNumber: true })} />
          </div>
          <div>
            <Label htmlFor="restockDate">Restock date</Label>
            <Input id="restockDate" type="date" defaultValue={initial?.restockDate ? initial.restockDate.slice(0, 10) : undefined} {...register("restockDate", { valueAsDate: true })} />
            <p className="mt-1 text-xs text-ink-400">Only shown to customers when set — leave blank if you don&rsquo;t have a real expected date.</p>
          </div>
        </div>
      </FormSection>
    </>
  );
}

export function VariantsStep({ state }: StepProps) {
  const { form, selectedConfig, attributes, initial } = state;
  const { control, register, watch, setValue, formState: { errors } } = form;
  return (
    <FormSection title="Options & Variants" description="Size, color, SKU, price override, and stock for each purchasable option.">
      <VariantEditor
        control={control}
        register={register}
        watch={watch}
        setValue={setValue}
        attributes={attributes}
        variantDimensions={selectedConfig?.variantDimensions}
        typeName={selectedConfig?.name}
        typeId={selectedConfig?.typeId}
        productImages={initial?.images ?? []}
        skuPrefix={(initial?.slug ?? watch("name") ?? "SKU").toString()}
      />
      {errors.variants && <p className="mt-1 text-xs text-danger-600">{errors.variants.message as string}</p>}
    </FormSection>
  );
}

export function CareStep({ state }: StepProps) {
  const { form, selectedConfig } = state;
  const { control, register, watch, setValue, formState: { errors } } = form;
  return <CareMaterialSection control={control} register={register} watch={watch} setValue={setValue} errors={errors} config={selectedConfig} />;
}

export function SizeGuideStep({ state }: StepProps) {
  const { form, selectedConfig } = state;
  if (!selectedConfig) return null;
  return (
    <FormSection title="Size Guide" description="Only shown next to the size picker when the product actually has a guide.">
      <SizeGuideEditor typeName={selectedConfig.name} sizeGuide={selectedConfig.sizeGuide} watch={form.watch} setValue={form.setValue} />
    </FormSection>
  );
}

export function ContentStep({ state, relationNames, onRelationNames }: StepProps & { relationNames: Record<string, string>; onRelationNames: (added: Record<string, string>) => void }) {
  const { form, globalSections, selectedConfig } = state;
  const { control, formState: { errors } } = form;
  return (
    <>
      <FormSection title="Page content" description="Choose which sections this product's page shows, their order and wording. Anything left as Inherit follows this product's template, then the store settings.">
        <Controller
          control={control}
          name="sections"
          render={({ field }) => (
            <SectionSettingsEditor
              level="product"
              base={{
                global: layerOf((globalSections?.overrides ?? []) as SectionOverrideInput[]),
                template: layerOf((selectedConfig?.sectionOverrides ?? []) as SectionOverrideInput[]),
              }}
              value={(field.value ?? []) as SectionOverrideInput[]}
              onChange={field.onChange}
            />
          )}
        />
        {errors.sections && <p className="mt-1 text-xs text-danger-600">{(errors.sections as { message?: string })?.message ?? "Check the section settings"}</p>}
      </FormSection>

      <FormSection title="Questions & answers" description="Shown as a FAQ section on the product page (when the FAQ section is on).">
        <Controller control={control} name="faqs" render={({ field }) => <FaqEditor value={field.value ?? []} onChange={field.onChange} />} />
        {errors.faqs && <p className="mt-1 text-xs text-danger-600">{(errors.faqs as { message?: string })?.message ?? "Every question needs an answer"}</p>}
      </FormSection>

      <FormSection title="Recommended products" description="Hand-pick what appears in each recommendation list. Leave a list empty and the store's automatic suggestions are used.">
        <Controller
          control={control}
          name="relations"
          render={({ field }) => (
            <RelatedProductsEditor
              value={(field.value ?? []) as { kind: string; productIds: string[] }[]}
              names={relationNames}
              onNames={onRelationNames}
              onChange={field.onChange as (rows: { kind: string; productIds: string[] }[]) => void}
            />
          )}
        />
      </FormSection>
    </>
  );
}

export function SeoStep({ state }: StepProps) {
  const { form, initial, canUseAi } = state;
  const { register, watch, setValue, formState: { errors } } = form;
  const productName = watch("name");
  const siteOrigin = typeof window === "undefined" ? "" : window.location.origin;
  const seoTitleText = watch("seoTitle") || productName || "";
  const defaultMeta = stripHtml(watch("shortDescription") || watch("description") || "").slice(0, 160);
  const metaText = watch("seoDescription") || defaultMeta;
  const slugText = watch("slug") || initial?.slug || slugify(productName ?? "");
  const keyword = (watch("focusKeyword") ?? "").trim().toLowerCase();
  const aiContext = { productName: productName || undefined, brand: watch("brand") ?? undefined };

  return (
    <>
      <FormSection title="Search listing" description="How this product appears in search results. Leave a field blank to use the automatic default shown in grey — nothing here is overwritten for you.">
        <div className="grid grid-cols-1 gap-4">
          <div>
            <Label htmlFor="slug">URL slug</Label>
            <div className="flex items-center gap-1 text-sm text-ink-400">
              <span className="shrink-0">/product/</span>
              <Input id="slug" placeholder="auto-generated from the name" {...register("slug")} />
            </div>
            {errors.slug && <p className="mt-1 text-xs text-danger-600">{errors.slug.message as string}</p>}
            {initial && initial.status === "PUBLISHED" && (
              <p className="mt-1 text-xs text-brass-700">This product is live — saving a new slug automatically redirects the old URL here, so existing links keep working.</p>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label htmlFor="seoTitle">SEO title</Label>
              {canUseAi && (
                <AiGenerateButton
                  disabled={!productName}
                  onGenerate={async () => {
                    const { text } = await aiApi.generateAiContent({ type: "seo_title", ...aiContext });
                    setValue("seoTitle", text, { shouldDirty: true });
                    return text;
                  }}
                />
              )}
            </div>
            <Input id="seoTitle" placeholder={productName || "Defaults to the product name"} {...register("seoTitle")} />
            <p className={cn("mt-1 text-xs", (watch("seoTitle") ?? "").length > 60 ? "text-brass-700" : "text-ink-400")}>{(watch("seoTitle") ?? "").length}/60 recommended</p>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label htmlFor="seoDescription">Meta description</Label>
              {canUseAi && (
                <AiGenerateButton
                  disabled={!productName}
                  onGenerate={async () => {
                    const { text } = await aiApi.generateAiContent({ type: "meta_description", ...aiContext });
                    setValue("seoDescription", text, { shouldDirty: true });
                    return text;
                  }}
                />
              )}
            </div>
            <Textarea id="seoDescription" rows={2} placeholder={defaultMeta || "Shown in search results"} {...register("seoDescription")} />
            <p className={cn("mt-1 text-xs", (watch("seoDescription") ?? "").length > 160 ? "text-brass-700" : "text-ink-400")}>{(watch("seoDescription") ?? "").length}/160 recommended</p>
          </div>

          <div>
            <Label htmlFor="focusKeyword">Focus keyword</Label>
            <Input id="focusKeyword" placeholder="e.g. black cotton panjabi" {...register("focusKeyword")} />
            {keyword && (
              <ul className="mt-1.5 space-y-0.5 text-xs" data-testid="keyword-checks">
                {[
                  ["in the SEO title", (seoTitleText || "").toLowerCase().includes(keyword)],
                  ["in the meta description", (metaText || "").toLowerCase().includes(keyword)],
                  ["in the URL", (slugText || "").includes(keyword.replace(/\s+/g, "-"))],
                ].map(([label, ok]) => (
                  <li key={label as string} className={ok ? "text-success-700" : "text-ink-400"}>
                    {ok ? "✓" : "○"} Keyword {ok ? "appears" : "not found"} {label as string}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-ink-100 bg-white p-4" data-testid="serp-preview">
          <p className="mb-2 text-xs uppercase tracking-wide text-ink-400">Search result preview</p>
          <p className="truncate text-lg text-blue-700">{(seoTitleText || "Untitled product").slice(0, 70)}</p>
          <p className="truncate text-xs text-success-700">{siteOrigin}/product/{slugText || "…"}</p>
          <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">{metaText || "No description — search engines will pick text from the page."}</p>
        </div>
      </FormSection>

      <FormSection title="Social sharing & canonical" description="Overrides for link previews and the canonical URL. Blank uses the defaults.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ogTitle">Social title</Label>
            <Input id="ogTitle" placeholder={seoTitleText || "Defaults to the SEO title"} {...register("ogTitle")} />
          </div>
          <div>
            <Label htmlFor="ogImageUrl">Social image URL</Label>
            <Input id="ogImageUrl" placeholder="Defaults to the product images" {...register("ogImageUrl")} />
            {errors.ogImageUrl && <p className="mt-1 text-xs text-danger-600">{errors.ogImageUrl.message as string}</p>}
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ogDescription">Social description</Label>
            <Textarea id="ogDescription" rows={2} placeholder={metaText || "Defaults to the meta description"} {...register("ogDescription")} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="canonicalUrl">Canonical URL</Label>
            <Input id="canonicalUrl" placeholder={`${siteOrigin}/product/${slugText || "…"}`} {...register("canonicalUrl")} />
            {errors.canonicalUrl && <p className="mt-1 text-xs text-danger-600">{errors.canonicalUrl.message as string}</p>}
            <p className="mt-1 text-xs text-ink-400">Only set this if another page is the &ldquo;main&rdquo; version of this product.</p>
          </div>
        </div>
      </FormSection>
    </>
  );
}

/** Placeholder until the embedded live preview lands — links out to the existing full-page preview
 * (real storefront components, works for any status) rather than duplicating that rendering here. */
export function PreviewStep({ state }: StepProps) {
  const { initial } = state;
  const id = initial?.id;
  return (
    <FormSection title="Live Preview" description="How customers will see this product.">
      {id ? (
        <Link
          href={`/preview/${id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 transition-colors duration-150 ease-smooth hover:border-ink-400 hover:text-ink-900"
        >
          Open preview in a new tab →
        </Link>
      ) : (
        <p className="text-sm text-ink-400">Fill in Basics and Pricing first — the preview needs a saved draft to render.</p>
      )}
      <p className="mt-2 text-xs text-ink-400">An embedded, live-updating preview alongside this wizard is coming in a later phase of this program.</p>
    </FormSection>
  );
}

export function ReviewStep({ state }: StepProps) {
  const { completeness, initial } = state;
  const id = initial?.id;
  return (
    <FormSection title="Final Review" description="Everything the publish gate checks, in one place.">
      <ul className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        {completeness.checks.map((c) => (
          <li key={c.key} className="flex items-center gap-2 text-sm">
            <span className={cn("h-1.5 w-1.5 rounded-full", c.status === "ok" ? "bg-success-500" : c.status === "na" ? "bg-ink-200" : c.required ? "bg-danger-500" : "bg-brass-500")} />
            <span className={c.status === "ok" ? "text-ink-700" : "text-ink-900"}>{c.label}</span>
            {c.status === "missing" && c.required && <span className="text-[11px] font-medium uppercase tracking-wide text-danger-600">required</span>}
          </li>
        ))}
      </ul>
      {id && (
        <Link href={`/preview/${id}`} target="_blank" rel="noreferrer" className="inline-block text-sm text-brass-600 hover:text-brass-700">
          Open the customer preview →
        </Link>
      )}
    </FormSection>
  );
}

export function PublishStep({ state }: StepProps) {
  const { completeness, initial } = state;
  const blocked = completeness.blockers.length > 0;
  return (
    <FormSection
      title="Publish"
      description={
        blocked
          ? "Not ready yet — use the panel above to fix what's missing, or Save Draft and come back."
          : initial?.status === "PUBLISHED"
            ? "This product is already live. Use the panel above to save changes or unpublish it."
            : "Ready to publish? Use the panel above — it always shows this product's status and the right action for it."
      }
    >
      <p className="text-sm text-ink-500">{initial?.name ?? "This product"} {blocked ? "still needs a few things before it can go live." : "is ready to go live whenever you are."}</p>
    </FormSection>
  );
}
