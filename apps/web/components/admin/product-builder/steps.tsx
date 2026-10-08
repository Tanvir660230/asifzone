"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Controller } from "react-hook-form";
import { AlertTriangle, Check, ExternalLink, ImageIcon, Layers, LayoutTemplate, MonitorSmartphone, Ruler, Search, Share2, Sparkles } from "lucide-react";
import { isBlankAttributeValue, slugify, type Category, type SectionOverrideInput } from "@clothing-brand/shared";
import { TagInput } from "@/components/admin/tag-input";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Field, FieldError } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { FormSection } from "@/components/ui/form-section";
import { VariantEditor } from "@/components/admin/variant-editor";
import { SizeGuideEditor } from "@/components/admin/size-guide-editor";
import { AttributeFields } from "@/components/admin/attribute-fields";
import { CareMaterialSection } from "@/components/admin/care-material-section";
import { SectionSettingsEditor, layerOf } from "@/components/admin/section-settings-editor";
import { FaqEditor, RelatedProductsEditor } from "@/components/admin/product-content-editors";
import { ImageUploader } from "@/components/admin/image-uploader";
import { AiGenerateButton } from "@/components/admin/ai-generate-button";
import { buildCategoryOptions } from "@/components/admin/product-form-state";
import * as aiApi from "@/lib/api/ai";
import { uploadEditorImage } from "@/lib/api/uploads";
import { storeCurrencyCode, stripHtml } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WizardActions, WizardState } from "./types";

// Tiptap is large and admin-only — loaded when the Basics step first renders, not with the page.
const RichTextEditor = dynamic(() => import("@/components/admin/rich-text-editor").then((m) => m.RichTextEditor), {
  ssr: false,
  loading: () => <div className="ui-skeleton h-40 rounded-lg" />,
});

/** Every step pane needs the shared form state; some add step-specific props on top. */
interface StepProps {
  state: WizardState;
}

/* ───────────────────────────────────────── Basics ───────────────────────────────────────── */

/** "Also show in": extra categories the product is listed under besides its home category — e.g. a unisex item that
 * lives in Men but should also appear when browsing Women. The home category is left out of the choices. */
function AlsoShowIn({ state, categories }: StepProps & { categories: Category[] }) {
  const { control, watch } = state.form;
  const homeId = watch("categoryId");
  const byId = new Map(categories.map((c) => [c.id, c]));
  // Full path ("Men › Panjabi"), so same-named subcategories under different parents stay distinguishable.
  const pathOf = (c: Category): string => {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    return parent ? `${pathOf(parent)} › ${c.name}` : c.name;
  };
  const choices = buildCategoryOptions(categories).filter((c) => c.id !== homeId);
  return (
    <Controller
      control={control}
      name="additionalCategoryIds"
      render={({ field }) => {
        const selected = new Set((field.value ?? []).filter((id) => id !== homeId));
        const toggle = (id: string) => {
          const next = new Set(selected);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          field.onChange([...next]);
        };
        return (
          <fieldset>
            <legend className="text-sm font-medium text-ink-900">Also show in</legend>
            <p className="mt-0.5 text-xs text-ink-500">
              Optional. List the product under more categories too — e.g. a unisex item in Men that should also appear in Women.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {choices.map((c) => {
                  const on = selected.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(c.id)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors",
                        on ? "border-brass-500 bg-brass-50 text-ink-900" : "border-ink-200 text-ink-600 hover:border-ink-400",
                      )}
                    >
                      {on && <Check size={12} aria-hidden="true" />}
                      {pathOf(byId.get(c.id)!)}
                    </button>
                  );
                })}
            </div>
          </fieldset>
        );
      }}
    />
  );
}

export function BasicsStep({ state, categories }: StepProps & { categories: Category[] }) {
  const { form, selectedConfig, canUseAi, typeId, types } = state;
  const { register, control, watch, setValue, formState: { errors } } = form;
  const categoryOptions = buildCategoryOptions(categories);
  const productName = watch("name");
  const aiContext = { productName: productName || undefined, category: categories.find((c) => c.id === watch("categoryId"))?.name, brand: watch("brand") ?? undefined };

  return (
    <>
      <FormSection title="Product identity" description="The essentials every product needs.">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field htmlFor="name" label="Product name" required error={errors.name?.message}>
            <Input id="name" autoComplete="off" {...register("name")} />
          </Field>

          <Field htmlFor="categoryId" label="Category" required error={errors.categoryId?.message}>
            <Select id="categoryId" {...register("categoryId")}>
              <option value="">Select a category…</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="sm:col-span-2">
            <AlsoShowIn state={state} categories={categories} />
          </div>

          <div className="sm:col-span-2">
            <Field htmlFor="typeId" label="Product type" required error={errors.typeId?.message} hint={selectedConfig?.description ?? undefined}>
              <Controller
                control={control}
                name="typeId"
                render={({ field }) => (
                  // Controlled on purpose: the options arrive after mount, and an uncontrolled select would keep the
                  // browser's "first option" instead of the product's saved type.
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
            </Field>
            <TypeSummary state={state} />
            <TypeChangeImpact state={state} />
          </div>

          <Field htmlFor="brand" label="Brand" hint="Shown on the product page and used in brand reports.">
            <Input id="brand" placeholder="e.g. House label" {...register("brand")} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Merchandising" description="How the product is positioned and ordered in the store.">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field htmlFor="brandTier" label="Tier">
            <Select id="brandTier" {...register("brandTier")}>
              <option value="PREMIUM">Premium</option>
              <option value="PLATINUM">Platinum</option>
              <option value="LUXURY">Luxury</option>
            </Select>
          </Field>
          <Field htmlFor="sortOrder" label="Sort order" hint="Lower numbers appear first within their category." error={errors.sortOrder?.message}>
            <Input id="sortOrder" type="number" inputMode="numeric" {...register("sortOrder", { valueAsNumber: true })} />
          </Field>
          <label className="flex items-center gap-2.5 self-start rounded-lg border border-line-subtle px-3 py-2.5 text-sm text-ink-700 sm:mt-6">
            <Checkbox {...register("isFeatured")} />
            <span>
              Featured
              <span className="block text-xs text-fg-muted">Eligible for featured carousels</span>
            </span>
          </label>
        </div>
      </FormSection>

      <FormSection
        title="Search tags"
        description="Other words customers might search for this product — spellings, Bangla, nicknames. They aren't shown on the store; they only help search find it."
      >
        <Field htmlFor="tags" label="Tags" hint="Press Enter or comma after each tag. e.g. attar, ator, আতর, fragrance" error={errors.tags?.message}>
          <Controller control={control} name="tags" render={({ field }) => <TagInput id="tags" value={field.value ?? []} onChange={field.onChange} />} />
        </Field>
      </FormSection>

      <FormSection title="Description" description="Short copy for listings; the full description for the product page.">
        <Field htmlFor="shortDescription" label="Short description" hint="One or two lines shown in listings and previews.">
          <Textarea id="shortDescription" rows={2} {...register("shortDescription")} />
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <Label>Description</Label>
            {canUseAi && (
              <AiGenerateButton
                disabled={!productName}
                onGenerate={async () => {
                  const { text } = await aiApi.generateAiContent({ type: "product_description", ...aiContext });
                  setValue("description", text.split(/\n{2,}/).map((p) => `<p>${p.trim()}</p>`).join(""), { shouldDirty: true });
                }}
              />
            )}
          </div>
          <Controller control={control} name="description" render={({ field }) => <RichTextEditor value={field.value ?? ""} onChange={field.onChange} uploadImage={uploadEditorImage} />} />
        </div>
      </FormSection>

      {selectedConfig && (
        <AttributeFields fields={selectedConfig.fields} control={control} errors={errors} title={`${selectedConfig.name} details`} description={selectedConfig.description ?? undefined} />
      )}
    </>
  );
}

/** What the chosen type brings to the builder — so the admin sees why steps appear or disappear. Read from the type's
 * resolved template config; nothing here is product-type specific. */
function TypeSummary({ state }: StepProps) {
  const { selectedConfig } = state;
  if (!selectedConfig) return null;
  const items = [
    selectedConfig.variantDimensions.length
      ? { icon: Layers, text: `Options: ${selectedConfig.variantDimensions.map((d) => d.label).join(" & ")}` }
      : { icon: Layers, text: "Single option (simple product)" },
    selectedConfig.fields.length > 0 && { icon: LayoutTemplate, text: `${selectedConfig.fields.length} detail field${selectedConfig.fields.length === 1 ? "" : "s"}` },
    selectedConfig.sizeGuide.mode !== "NOT_APPLICABLE" && { icon: Ruler, text: "Size guide" },
  ].filter(Boolean) as { icon: typeof Layers; text: string }[];
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`What ${selectedConfig.name} includes`}>
      {items.map(({ icon: Icon, text }) => (
        <li key={text} className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs text-ink-600 ring-1 ring-inset ring-line-subtle">
          <Icon size={12} aria-hidden="true" /> {text}
        </li>
      ))}
    </ul>
  );
}

/** Changing a saved product's type must never silently destroy data — say exactly what the switch does before it's
 * saved. Attribute values the new type doesn't use are kept (hidden) by the API and come back on switching back;
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
    <div className="mt-3" data-testid="type-change-impact">
      <Alert variant="warning" title={`Switching from ${previous.name} to ${selectedConfig.name}`}>
        <ul className="list-disc space-y-0.5 pl-4">
          {hidden.length > 0 && (
            <li>
              Kept but hidden: {hidden.map((f) => f.label).join(", ")} — {selectedConfig.name} doesn&rsquo;t use {hidden.length === 1 ? "it" : "them"}, and{" "}
              {hidden.length === 1 ? "it comes" : "they come"} back if you switch back.
            </li>
          )}
          {added.map((label) => (
            <li key={label}>
              {selectedConfig.name} asks for a {label} on every variant — add one to each before the next save can go through.
            </li>
          ))}
          {removed.map((label) => (
            <li key={label}>
              {label} is no longer an option for {selectedConfig.name}; variants keep the values they have.
            </li>
          ))}
          {newlyRequired.length > 0 && <li>Required for {selectedConfig.name}: {newlyRequired.map((f) => f.label).join(", ")}.</li>}
          {hidden.length + added.length + removed.length + newlyRequired.length === 0 && <li>Nothing you&rsquo;ve entered is affected.</li>}
        </ul>
      </Alert>
    </div>
  );
}

/* ───────────────────────────────────────── Media ───────────────────────────────────────── */

export function MediaStep({ state }: StepProps) {
  const { initial, stagedImages, onStagedChange } = state;
  const count = initial ? initial.images.length : stagedImages.length;
  return (
    <>
      {count === 0 && (
        <Alert variant="neutral" icon={false} title="At least one photo is needed to publish">
          {initial
            ? "Uploads start straight away; each is stored in several sizes for fast loading."
            : "Photos added now are uploaded as soon as the draft is created — you can keep going in the meantime."}
        </Alert>
      )}
      <ImageUploader productId={initial?.id} images={initial?.images} staged={initial ? undefined : stagedImages} onStagedChange={onStagedChange} />
    </>
  );
}

/* ──────────────────────────────────── Pricing & Inventory ───────────────────────────────── */

export function PricingStep({ state }: StepProps) {
  const { form, initial, selectedConfig } = state;
  const variantRows = (form.watch("variants") ?? []) as unknown[];
  // A product with no size/colour options is a first-class simple product — its SKU and stock belong with its price.
  const simple = Boolean(selectedConfig) && selectedConfig!.variantDimensions.length === 0;
  const { register, formState: { errors } } = form;
  const currency = storeCurrencyCode();
  const basePrice = form.watch("basePrice");
  const costPrice = form.watch("costPrice");
  // A display hint only — nothing is priced from it (the server's pricing engine decides every charged amount).
  const margin = basePrice && costPrice && basePrice > 0 ? (((basePrice - costPrice) / basePrice) * 100).toFixed(1) : null;
  const money = { leading: currency, type: "number", step: "0.01", inputMode: "decimal" as const, min: 0 };

  return (
    <>
      <FormSection title="Price" description="Variants sell at this price unless they set their own.">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field htmlFor="basePrice" label={`Base price (${currency})`} required error={errors.basePrice?.message}>
            <Input id="basePrice" {...money} className="pl-14" {...register("basePrice", { valueAsNumber: true })} />
          </Field>
          <Field htmlFor="compareAtPrice" label="Compare-at price" hint="Shown struck through when higher." error={errors.compareAtPrice?.message}>
            <Input id="compareAtPrice" {...money} className="pl-14" placeholder="Optional" {...register("compareAtPrice", { valueAsNumber: true })} />
          </Field>
          <Field htmlFor="costPrice" label="Cost price" hint="Private — used for margin reports." error={errors.costPrice?.message}>
            <Input id="costPrice" {...money} className="pl-14" placeholder="Optional" {...register("costPrice", { valueAsNumber: true })} />
          </Field>
        </div>
        {margin && (
          <p className="text-sm text-fg-muted">
            Estimated margin at base price: <span className="font-medium text-fg">{margin}%</span>
          </p>
        )}
      </FormSection>

      <FormSection title="Tax" description="Leave blank to use the store's tax settings.">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field htmlFor="taxRate" label="Tax rate" error={errors.taxRate?.message}>
            <Input id="taxRate" type="number" step="0.01" inputMode="decimal" min={0} trailing="%" placeholder="Store default" {...register("taxRate", { valueAsNumber: true })} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Shipping" description="How delivery is charged for this product.">
        <label className="flex items-start gap-2.5 text-sm text-ink-700">
          <Checkbox className="mt-0.5" {...register("freeDelivery")} />
          <span>
            Free delivery
            <span className="block text-xs text-fg-muted">
              Delivery is free when every item in the cart has free delivery. If the cart also has other products, the normal delivery fee applies.
              Orders already placed keep the delivery fee they were charged.
            </span>
          </span>
        </label>
      </FormSection>

      <FormSection title="Inventory" description="Stock tracking and the low-stock warning.">
        <label className="flex items-start gap-2.5 text-sm text-ink-700">
          <Checkbox className="mt-0.5" {...register("trackInventory")} />
          <span>
            Track inventory for this product
            <span className="block text-xs text-fg-muted">Untracked products never sell out.</span>
          </span>
        </label>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Field htmlFor="lowStockThreshold" label="Low stock threshold" hint="Warn when stock falls to this." error={errors.lowStockThreshold?.message}>
            <Input id="lowStockThreshold" type="number" inputMode="numeric" min={0} {...register("lowStockThreshold", { valueAsNumber: true })} />
          </Field>
          <Field htmlFor="restockDate" label="Restock date" hint="Only shown to customers when set.">
            <Input id="restockDate" type="date" defaultValue={initial?.restockDate ? initial.restockDate.slice(0, 10) : undefined} {...register("restockDate", { valueAsDate: true })} />
          </Field>
        </div>
      </FormSection>

      {simple && (
        <FormSection title="SKU & stock" description="This product has no size or colour options, so its SKU and stock are set here.">
          {variantRows.map((_, i) => (
            <div key={i} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field htmlFor={`simple-sku-${i}`} label={variantRows.length > 1 ? `SKU (${i + 1})` : "SKU"} hint={initial ? undefined : "Generated from the SKU pattern when the draft is created."}>
                <Input id={`simple-sku-${i}`} placeholder={initial ? "SKU-001" : "Generated automatically"} {...form.register(`variants.${i}.sku`)} />
              </Field>
              <Field htmlFor={`simple-stock-${i}`} label={variantRows.length > 1 ? `Stock (${i + 1})` : "Stock"}>
                <Input id={`simple-stock-${i}`} type="number" inputMode="numeric" min={0} {...form.register(`variants.${i}.stock`, { valueAsNumber: true })} />
              </Field>
            </div>
          ))}
        </FormSection>
      )}
    </>
  );
}

/* ──────────────────────────────────── Options & Variants ────────────────────────────────── */

export function VariantsStep({ state }: StepProps) {
  const { form, selectedConfig, attributes, initial } = state;
  const { control, register, watch, setValue, formState: { errors } } = form;
  return (
    <>
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
      {errors.variants && <FieldError>{(errors.variants.message as string) ?? "Check the variants above"}</FieldError>}
    </>
  );
}

/* ─────────────────────────────────── Care, Size guide ───────────────────────────────────── */

export function CareStep({ state }: StepProps) {
  const { form, selectedConfig } = state;
  const { control, register, watch, setValue, formState: { errors } } = form;
  return <CareMaterialSection control={control} register={register} watch={watch} setValue={setValue} errors={errors} config={selectedConfig} />;
}

export function SizeGuideStep({ state }: StepProps) {
  const { form, selectedConfig } = state;
  if (!selectedConfig) return null;
  return <SizeGuideEditor typeName={selectedConfig.name} sizeGuide={selectedConfig.sizeGuide} watch={form.watch} setValue={form.setValue} />;
}

/* ─────────────────────────────────────── Page content ───────────────────────────────────── */

export function ContentStep({ state, relationNames, onRelationNames }: StepProps & { relationNames: Record<string, string>; onRelationNames: (added: Record<string, string>) => void }) {
  const { form, globalSections, selectedConfig } = state;
  const { control, formState: { errors } } = form;
  return (
    <>
      <FormSection
        title="Page sections"
        description={`Turn sections on or off, reorder them and change their wording. Anything left as "Inherit" follows the ${selectedConfig?.name ?? "product type"} template, then the store default — so most products need no changes here.`}
      >
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
        {errors.sections && <FieldError>{(errors.sections as { message?: string })?.message ?? "Check the section settings"}</FieldError>}
      </FormSection>

      <FormSection title="Questions & answers" description="Shown as a FAQ section on the product page (when the FAQ section is on).">
        <Controller control={control} name="faqs" render={({ field }) => <FaqEditor value={field.value ?? []} onChange={field.onChange} />} />
        {errors.faqs && <FieldError>{(errors.faqs as { message?: string })?.message ?? "Every question needs an answer"}</FieldError>}
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

/* ─────────────────────────────────────────── SEO ────────────────────────────────────────── */

/** Recommended-length meter for a search field. */
function LengthMeter({ length, max }: { length: number; max: number }) {
  const over = length > max;
  return (
    <span className="flex items-center gap-2" aria-live="polite">
      <span className="h-1 w-16 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
        <span className={cn("block h-full rounded-full transition-[width] duration-base", over ? "bg-warning-500" : "bg-success-500")} style={{ width: `${Math.min(100, (length / max) * 100)}%` }} />
      </span>
      <span className={cn("tabular-nums", over && "text-warning-700")}>
        {length}/{max} recommended
      </span>
    </span>
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
  const host = siteOrigin.replace(/^https?:\/\//, "");

  return (
    <>
      <FormSection title="Search listing" description="Leave a field blank to use the automatic default shown in grey — nothing here is overwritten for you.">
        <div className="rounded-xl border border-line-subtle bg-surface p-4 shadow-sm" data-testid="serp-preview">
          <p className="mb-3 flex items-center gap-1.5 text-caption font-semibold uppercase text-fg-subtle">
            <Search size={12} aria-hidden="true" /> Search result preview
          </p>
          <p className="truncate text-xs text-ink-600">
            {host} › product › {slugText || "…"}
          </p>
          <p className="mt-0.5 truncate text-lg leading-snug text-[#1a0dab]">{(seoTitleText || "Untitled product").slice(0, 70)}</p>
          <p className="mt-1 line-clamp-2 text-sm text-ink-600">{metaText || "No description — search engines will pick text from the page."}</p>
        </div>

        <Field htmlFor="slug" label="URL slug" error={errors.slug?.message as string | undefined}>
          <Input id="slug" leading="/product/" className="pl-[4.75rem]" placeholder="auto-generated from the name" {...register("slug")} />
        </Field>
        <LiveSlugChange state={state} actions={actions} />

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <Label htmlFor="seoTitle" className="mb-0">
              SEO title
            </Label>
            {canUseAi && (
              <AiGenerateButton
                disabled={!productName}
                onGenerate={async () => {
                  const { text } = await aiApi.generateAiContent({ type: "seo_title", ...aiContext });
                  setValue("seoTitle", text, { shouldDirty: true });
                }}
              />
            )}
          </div>
          <Input id="seoTitle" placeholder={productName || "Defaults to the product name"} {...register("seoTitle")} />
          <p className="ui-field-hint">
            <LengthMeter length={(watch("seoTitle") ?? "").length} max={60} />
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <Label htmlFor="seoDescription" className="mb-0">
              Meta description
            </Label>
            {canUseAi && (
              <AiGenerateButton
                disabled={!productName}
                onGenerate={async () => {
                  const { text } = await aiApi.generateAiContent({ type: "meta_description", ...aiContext });
                  setValue("seoDescription", text, { shouldDirty: true });
                }}
              />
            )}
          </div>
          <Textarea id="seoDescription" rows={2} placeholder={defaultMeta || "Shown in search results"} {...register("seoDescription")} />
          <p className="ui-field-hint">
            <LengthMeter length={(watch("seoDescription") ?? "").length} max={160} />
          </p>
        </div>

        <Field htmlFor="focusKeyword" label="Focus keyword" hint={keyword ? undefined : "The phrase you'd like this product to be found by."}>
          <Input id="focusKeyword" placeholder="e.g. black cotton shirt" {...register("focusKeyword")} />
        </Field>
        {keyword && (
          <ul className="-mt-2 space-y-1 text-xs" data-testid="keyword-checks">
            {[
              ["in the SEO title", (seoTitleText || "").toLowerCase().includes(keyword)],
              ["in the meta description", (metaText || "").toLowerCase().includes(keyword)],
              ["in the URL", (slugText || "").includes(keyword.replace(/\s+/g, "-"))],
            ].map(([label, ok]) => (
              <li key={label as string} className={cn("flex items-center gap-1.5", ok ? "text-success-700" : "text-fg-muted")}>
                {ok ? <Check size={12} aria-hidden="true" /> : <span className="h-3 w-3 rounded-full border border-line-strong" aria-hidden="true" />}
                Keyword {ok ? "appears" : "not found"} {label as string}
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection title="Social sharing & canonical" description="Overrides for link previews and the canonical URL. Blank uses the defaults.">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field htmlFor="ogTitle" label="Social title">
            <Input id="ogTitle" placeholder={seoTitleText || "Defaults to the SEO title"} {...register("ogTitle")} />
          </Field>
          <Field htmlFor="ogImageUrl" label="Social image URL" error={errors.ogImageUrl?.message as string | undefined}>
            <Input id="ogImageUrl" placeholder="Defaults to the product images" {...register("ogImageUrl")} />
          </Field>
          <Field htmlFor="ogDescription" label="Social description" className="sm:col-span-2">
            <Textarea id="ogDescription" rows={2} placeholder={metaText || "Defaults to the meta description"} {...register("ogDescription")} />
          </Field>
          <Field
            htmlFor="canonicalUrl"
            label="Canonical URL"
            className="sm:col-span-2"
            error={errors.canonicalUrl?.message as string | undefined}
            hint={'Only set this if another page is the "main" version of this product.'}
          >
            <Input id="canonicalUrl" placeholder={`${siteOrigin}/product/${slugText || "…"}`} {...register("canonicalUrl")} />
          </Field>
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
    return <p className="-mt-3 text-xs text-fg-muted">This product is live. Its URL only changes when you confirm it here — the old address then redirects to the new one.</p>;
  }
  return (
    <div data-testid="slug-change-notice">
      <Alert
        variant="warning"
        title="Change this live product's URL?"
        action={
          <span className="flex flex-wrap gap-2">
            <Button type="button" size="sm" loading={actions.applyingSlug} onClick={() => actions.applySlug(typed)}>
              Change URL
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={actions.applyingSlug} onClick={() => form.setValue("slug", initial.slug, { shouldDirty: true })}>
              Keep current URL
            </Button>
          </span>
        }
      >
        It&rsquo;s live at <code>/product/{initial.slug}</code>. Changing it to <code>/product/{typed}</code> adds a permanent (301) redirect from the old
        address, so existing links and search results keep working.
      </Alert>
    </div>
  );
}

/* ─────────────────────────────────────── Live preview ───────────────────────────────────── */

/** The live preview sits beside every step; this step is the moment to look at it on purpose. */
export function PreviewStep({ state }: StepProps) {
  const { initial } = state;
  const points = [
    { icon: Sparkles, text: "The preview updates as you type — nothing has to be saved first." },
    { icon: MonitorSmartphone, text: "Switch between product page, listing, search, social and Google, on desktop, tablet and mobile." },
    { icon: ImageIcon, text: "Sections you turned off (care, size guide, FAQ…) don't appear, just as they won't on the store." },
    { icon: Share2, text: "Reviews and recommendations come from live store data, so they appear on the full saved page." },
  ];
  return (
    <>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {points.map(({ icon: Icon, text }) => (
          <li key={text} className="flex gap-3 rounded-xl border border-line-subtle bg-surface-muted/60 p-4 text-sm text-ink-700">
            <Icon size={18} className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
            {text}
          </li>
        ))}
      </ul>
      {initial?.id && (
        <Link href={`/preview/${initial.id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
          <ExternalLink size={14} aria-hidden="true" /> Open the full saved page
        </Link>
      )}
    </>
  );
}

/* ─────────────────────────────────────── Final review ───────────────────────────────────── */

export function ReviewStep({ state, actions }: StepProps & { actions: WizardActions }) {
  const { completeness } = state;
  // Only what applies to this product: a check that doesn't apply isn't listed at all.
  const checks = completeness.checks.filter((c) => c.status !== "na");
  const blockers = completeness.blockers;
  const suggestions = checks.filter((c) => c.status === "missing" && !c.required);

  return (
    <>
      <div className="flex items-center gap-4 rounded-xl border border-line-subtle bg-surface-muted/60 p-4">
        <ProgressRing value={completeness.score} tone={blockers.length ? "threshold" : "accent"} size={56} label="Product completeness" />
        <div>
          <p className={cn("text-sm font-medium", blockers.length ? "text-danger-700" : "text-success-700")} data-testid="review-summary">
            {blockers.length ? `${blockers.length} ${blockers.length === 1 ? "thing needs" : "things need"} attention before this can go live` : "Everything required is complete"}
            {suggestions.length > 0 && (
              <span className="font-normal text-fg-muted">
                {" "}
                · {suggestions.length} optional {suggestions.length === 1 ? "suggestion" : "suggestions"}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">The same checks the store runs before publishing.</p>
        </div>
      </div>
      <ul className="divide-y divide-line-subtle overflow-hidden rounded-xl border border-line-subtle">
        {checks.map((c) => (
          <li key={c.key} className="flex items-center gap-3 bg-surface px-4 py-3 text-sm" data-testid={`review-check-${c.key}`} data-status={c.status}>
            {c.status === "ok" ? (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-50 text-success-600">
                <Check size={14} aria-label="Complete" />
              </span>
            ) : (
              <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", c.required ? "bg-danger-50 text-danger-600" : "bg-warning-50 text-warning-600")}>
                <AlertTriangle size={13} aria-label={c.required ? "Required" : "Suggested"} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-fg">
                {c.label}
                {c.status === "missing" && (
                  <Badge variant={c.required ? "danger" : "warning"} className="px-2 py-0 text-[0.6875rem]">
                    {c.required ? "Required" : "Suggested"}
                  </Badge>
                )}
              </p>
              {c.status === "missing" && <p className="text-xs text-fg-muted">{c.detail ?? c.hint}</p>}
            </div>
            {c.status === "missing" && (
              <Button type="button" size="sm" variant="outline" onClick={() => actions.fix(c.key)}>
                Fix
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/* ────────────────────────────────────────── Publish ─────────────────────────────────────── */

export function PublishStep({ state, actions }: StepProps & { actions: WizardActions }) {
  const { completeness, initial, form } = state;
  if (!initial) return null;
  const blockers = completeness.blockers;
  const name = form.watch("name") || initial.name;
  const live = initial.status === "PUBLISHED";
  const viewLink = (
    <a href={`/product/${initial.slug}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
      <ExternalLink size={14} aria-hidden="true" /> View product
    </a>
  );

  if (live) {
    return (
      <div className="space-y-4 rounded-2xl border border-success-200 bg-success-50 p-6" role="status" data-testid="publish-live">
        <p className="flex items-center gap-2 font-display text-xl text-success-700">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-500 text-white">
            <Check size={18} aria-hidden="true" />
          </span>
          {actions.justPublished ? "Product published" : "This product is live"}
        </p>
        <p className="text-sm text-ink-700">{actions.justPublished ? "Your product is now live on the store." : `${name} is on the store now. Changes save as you make them.`}</p>
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
    );
  }

  if (blockers.length) {
    return (
      <div className="space-y-4 rounded-2xl border border-danger-200 bg-danger-50 p-6" data-testid="publish-blocked">
        <p className="font-display text-xl text-danger-700">
          {blockers.length} {blockers.length === 1 ? "thing needs" : "things need"} attention
        </p>
        <ol className="space-y-2">
          {blockers.map((b, i) => (
            <li key={b.key} className="flex items-center justify-between gap-3 rounded-lg bg-surface/70 px-3 py-2 text-sm text-ink-800">
              <span>
                {i + 1}. {b.detail ?? b.label}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => actions.fix(b.key)}>
                Fix
              </Button>
            </li>
          ))}
        </ol>
        <Button type="button" disabled title="Fix the items above first">
          Publish product
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-line-subtle bg-surface-muted/60 p-6" data-testid="publish-ready">
      <p className="font-display text-xl text-fg">Ready to publish?</p>
      <p className="text-sm text-ink-700">
        Product: <span className="font-medium text-fg">{name}</span>
      </p>
      <p className="text-sm text-fg-muted">All required information is complete. Publishing puts it on the store straight away.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={actions.busy} onClick={() => void actions.saveWithStatus()}>
          Save draft
        </Button>
        <Button type="button" loading={actions.busy} onClick={() => void actions.saveWithStatus("PUBLISHED")}>
          Publish product
        </Button>
      </div>
    </div>
  );
}
