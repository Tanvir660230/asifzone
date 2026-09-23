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
import type { WizardActions, WizardState } from "./types";
import * as aiApi from "@/lib/api/ai";
import { stripHtml } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isBlankAttributeValue, slugify, type Category } from "@clothing-brand/shared";
import { AlertTriangle, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Every step pane needs the shared form state; most add a couple of step-specific props on top. */
interface StepProps {
  state: WizardState;
}

export function BasicsStep({ state, categories }: StepProps & { categories: Category[] }) {
  const { form, selectedConfig, canUseAi, typeId, types } = state;
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
            <TypeChangeImpact state={state} />
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

/** Spec: changing a saved product's type must never silently destroy data — say exactly what the switch does before
 * it's saved. Attribute values the new type doesn't use are kept (hidden) by the API and come back on switching back;
 * variant values are never touched, but a newly required option has to be filled before the next save succeeds. */
function TypeChangeImpact({ state }: StepProps) {
  const { initial, types, selectedConfig, form } = state;
  const previous = initial ? types.find((t) => t.typeId === initial.typeId) : undefined;
  if (!previous || !selectedConfig || previous.typeId === selectedConfig.typeId) return null;

  const attributes = (form.watch("attributes") ?? {}) as Record<string, unknown>;
  const hidden = previous.fields.filter((f) => !selectedConfig.fields.some((n) => n.key === f.key) && !isBlankAttributeValue(attributes[f.key]));
  const newlyRequired = selectedConfig.fields.filter((f) => f.required && isBlankAttributeValue(attributes[f.key]));
  const dims = (c: typeof selectedConfig) => new Map(c.variantDimensions.map((d) => [d.targetField, d.label]));
  const before = dims(previous);
  const after = dims(selectedConfig);
  const added = [...after].filter(([field]) => !before.has(field)).map(([, label]) => label);
  const removed = [...before].filter(([field]) => !after.has(field)).map(([, label]) => label);

  return (
    <div className="mt-2 space-y-1 rounded-md border border-brass-200 bg-brass-50 px-3 py-2 text-xs text-brass-900" role="status" data-testid="type-change-impact">
      <p className="font-medium">Switching from {previous.name} to {selectedConfig.name}:</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {hidden.length > 0 && (
          <li>
            Kept but hidden: {hidden.map((f) => f.label).join(", ")} — {selectedConfig.name} doesn&rsquo;t use {hidden.length === 1 ? "it" : "them"}, and{" "}
            {hidden.length === 1 ? "it comes" : "they come"} back if you switch back.
          </li>
        )}
        {added.map((label) => (
          <li key={label}>{selectedConfig.name} asks for a {label} on every variant — add one to each before the next save can go through.</li>
        ))}
        {removed.map((label) => (
          <li key={label}>{label} is no longer an option for {selectedConfig.name}; variants keep the values they have.</li>
        ))}
        {newlyRequired.length > 0 && <li>Required for {selectedConfig.name}: {newlyRequired.map((f) => f.label).join(", ")}.</li>}
        {hidden.length + added.length + removed.length + newlyRequired.length === 0 && <li>Nothing you&rsquo;ve entered is affected.</li>}
      </ul>
    </div>
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
  const { form, initial, selectedConfig } = state;
  const variantRows = (form.watch("variants") ?? []) as unknown[];
  // Spec §16/§24: a product with no size/colour options is a first-class simple product — its SKU and stock belong
  // with its price, not behind a Variants step it doesn't have.
  const simple = Boolean(selectedConfig) && selectedConfig!.variantDimensions.length === 0;
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

      {simple && (
        <FormSection title="SKU & stock" description="This product has no size or colour options, so its SKU and stock are set here.">
          {variantRows.map((_, i) => (
            <div key={i} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor={`simple-sku-${i}`}>{variantRows.length > 1 ? `SKU (${i + 1})` : "SKU"}</Label>
                <Input id={`simple-sku-${i}`} placeholder={initial ? "SKU-001" : "Generated when the draft is created"} {...form.register(`variants.${i}.sku`)} />
              </div>
              <div>
                <Label htmlFor={`simple-stock-${i}`}>{variantRows.length > 1 ? `Stock (${i + 1})` : "Stock"}</Label>
                <Input id={`simple-stock-${i}`} type="number" min={0} {...form.register(`variants.${i}.stock`, { valueAsNumber: true })} />
              </div>
            </div>
          ))}
        </FormSection>
      )}
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

export function SeoStep({ state, actions }: StepProps & { actions: WizardActions }) {
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
            <LiveSlugChange state={state} actions={actions} />
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

/** A live product's URL isn't autosaved (every keystroke would otherwise become a live URL and a redirect): the new
 * slug is shown with exactly what saving it does, and only changes when the admin confirms. */
function LiveSlugChange({ state, actions }: StepProps & { actions: WizardActions }) {
  const { initial, form } = state;
  if (!initial || initial.status !== "PUBLISHED") return null;
  const typed = slugify(form.watch("slug") || "");
  if (!typed || typed === initial.slug) {
    return <p className="mt-1 text-xs text-ink-500">This product is live. Its URL only changes when you confirm it here — the old address will then redirect to the new one.</p>;
  }
  return (
    <div className="mt-2 space-y-2 rounded-md border border-brass-200 bg-brass-50 px-3 py-2 text-xs text-brass-900" role="alert" data-testid="slug-change-notice">
      <p>
        This product is live at <code>/product/{initial.slug}</code>. Changing its URL to <code>/product/{typed}</code> adds a permanent (301) redirect from
        the old address, so links and search results that point there keep working.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="brass" disabled={actions.applyingSlug} onClick={() => actions.applySlug(typed)}>
          {actions.applyingSlug ? "Changing…" : "Change URL"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={actions.applyingSlug} onClick={() => form.setValue("slug", initial.slug, { shouldDirty: true })}>
          Keep current URL
        </Button>
      </div>
    </div>
  );
}

/** The live preview itself sits beside every step (see PreviewPane); this step is the moment to look at it on purpose,
 * and — once saved — to open the full page, which also fills in reviews and recommendations from live store data. */
export function PreviewStep({ state }: StepProps) {
  const { initial } = state;
  return (
    <FormSection title="Live Preview" description="Check how customers will see this product before you review and publish.">
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-600">
        <li>The preview beside this form updates as you type — nothing has to be saved first.</li>
        <li>Switch between Product page, Listing, Search, Social and Google, and between desktop, tablet and mobile.</li>
        <li>Sections you turned off (care, size guide, FAQ, …) don&rsquo;t appear there, just as they won&rsquo;t on the store.</li>
      </ul>
      {initial?.id && (
        <Link
          href={`/preview/${initial.id}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 transition-colors duration-150 ease-smooth hover:border-ink-400 hover:text-ink-900"
        >
          Open the full saved page, with reviews and recommendations →
        </Link>
      )}
    </FormSection>
  );
}

export function ReviewStep({ state, actions }: StepProps & { actions: WizardActions }) {
  const { completeness } = state;
  // Only what applies to this product: a check that doesn't apply (no size guide on this type, Care switched off, ...)
  // isn't listed at all, rather than shown as a pass or a gap.
  const checks = completeness.checks.filter((c) => c.status !== "na");
  const blockers = completeness.blockers;
  const suggestions = checks.filter((c) => c.status === "missing" && !c.required);

  return (
    <FormSection title="Final Review" description="Everything the publish gate checks for this product, and anything worth another look.">
      <p className={cn("text-sm font-medium", blockers.length ? "text-danger-700" : "text-success-700")} data-testid="review-summary">
        {blockers.length
          ? `${blockers.length} ${blockers.length === 1 ? "thing needs" : "things need"} attention before this can go live`
          : "Everything required is complete"}
        {suggestions.length > 0 && <span className="font-normal text-ink-500"> · {suggestions.length} optional {suggestions.length === 1 ? "suggestion" : "suggestions"}</span>}
      </p>
      <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100">
        {checks.map((c) => (
          <li key={c.key} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid={`review-check-${c.key}`} data-status={c.status}>
            {c.status === "ok" ? (
              <Check size={15} className="shrink-0 text-success-600" aria-label="Complete" />
            ) : (
              <AlertTriangle size={15} className={cn("shrink-0", c.required ? "text-danger-600" : "text-brass-600")} aria-label={c.required ? "Required" : "Suggested"} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-ink-900">
                {c.label}
                {c.status === "missing" && c.required && <span className="ml-2 text-[11px] font-medium uppercase tracking-wide text-danger-600">required</span>}
              </p>
              {c.status === "missing" && <p className="text-xs text-ink-500">{c.detail ?? c.hint}</p>}
            </div>
            {c.status === "missing" && (
              <Button type="button" size="sm" variant="outline" onClick={() => actions.fix(c.key)}>
                Fix
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-400">The customer preview beside this form shows the product as it will appear — switch device and surface there.</p>
    </FormSection>
  );
}

export function PublishStep({ state, actions }: StepProps & { actions: WizardActions }) {
  const { completeness, initial, form } = state;
  if (!initial) return null;
  const blockers = completeness.blockers;
  const name = form.watch("name") || initial.name;
  const live = initial.status === "PUBLISHED";
  const viewLink = (
    <a
      href={`/product/${initial.slug}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:border-ink-400 hover:text-ink-900"
    >
      <ExternalLink size={14} /> View product
    </a>
  );

  if (live) {
    return (
      <FormSection title="Publish">
        <div className="space-y-3 rounded-xl border border-success-200 bg-success-50 p-5" role="status" data-testid="publish-live">
          <p className="flex items-center gap-2 text-base font-medium text-success-800">
            <Check size={18} /> {actions.justPublished ? "Product published" : "This product is live"}
          </p>
          <p className="text-sm text-success-800">{actions.justPublished ? "Your product is now live on the store." : `${name} is on the store now. Changes save as you make them.`}</p>
          <div className="flex flex-wrap gap-2">
            {viewLink}
            <Button type="button" variant="outline" onClick={() => actions.goTo("basics")}>
              Continue editing
            </Button>
            {!actions.justPublished && (
              <Button type="button" variant="outline" disabled={actions.busy} onClick={() => void actions.saveWithStatus("UNPUBLISHED")}>
                Unpublish
              </Button>
            )}
          </div>
        </div>
      </FormSection>
    );
  }

  if (blockers.length) {
    return (
      <FormSection title="Publish">
        <div className="space-y-3 rounded-xl border border-danger-200 bg-danger-50 p-5" data-testid="publish-blocked">
          <p className="text-base font-medium text-danger-800">
            {blockers.length} {blockers.length === 1 ? "thing needs" : "things need"} attention
          </p>
          <ol className="space-y-2">
            {blockers.map((b, i) => (
              <li key={b.key} className="flex items-center justify-between gap-3 text-sm text-danger-900">
                <span>
                  {i + 1}. {b.detail ?? b.label}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => actions.fix(b.key)}>
                  Fix
                </Button>
              </li>
            ))}
          </ol>
          <Button type="button" variant="brass" disabled title="Fix the items above first">
            Publish product
          </Button>
        </div>
      </FormSection>
    );
  }

  return (
    <FormSection title="Publish">
      <div className="space-y-3 rounded-xl border border-ink-100 bg-cream-50 p-5" data-testid="publish-ready">
        <p className="text-base font-medium text-ink-900">Ready to publish?</p>
        <p className="text-sm text-ink-600">
          Product: <span className="font-medium text-ink-900">{name}</span>
        </p>
        <p className="text-sm text-ink-600">All required information is complete. Publishing puts it on the store straight away.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={actions.busy} onClick={() => void actions.saveWithStatus()}>
            Save draft
          </Button>
          <Button type="button" variant="brass" disabled={actions.busy} onClick={() => void actions.saveWithStatus("PUBLISHED")}>
            {actions.busy ? "Publishing…" : "Publish product"}
          </Button>
        </div>
      </div>
    </FormSection>
  );
}
