"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { LANDING_TEMPLATES, LANDING_TEMPLATE_KEYS, slugify, type LandingTemplateKey } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { ProductPicker } from "@/components/admin/product-picker";
import * as api from "@/lib/api/admin-landing-pages";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** New campaign page: a name, its address, the product it sells and a template to start from. The template is copied
 * into the page, so editing the page never changes the template. */
export function NewLandingPageDialog({ open, onClose, initialProduct }: { open: boolean; onClose: () => void; initialProduct?: { id: string; name: string } }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [product, setProduct] = useState<{ id: string; name: string } | null>(initialProduct ?? null);
  const [template, setTemplate] = useState<LandingTemplateKey>("single");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createLandingPage({ name: name.trim(), slug, productId: product!.id, templateKey: template }),
    onSuccess: ({ page }) => {
      toast.success("Page created — it's a draft until you publish it");
      router.push(`/admin/marketing/landing-pages/${page.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't create the page — try again"),
  });

  const ready = name.trim().length > 0 && slug.length > 0 && product !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New landing page"
      description="A campaign page for one product. It sells the product's own variants and stock — nothing is copied."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!ready} loading={create.isPending} data-testid="lp-create">
            Create draft
          </Button>
        </div>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) create.mutate();
        }}
      >
        <Field htmlFor="lp-name" label="Name" hint="Only you see this — e.g. “Eid jackets — black & navy”.">
          <Input
            id="lp-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            autoFocus
          />
        </Field>
        <Field htmlFor="lp-slug" label="Address" hint={slug ? `/lp/${slug}` : "Lowercase letters, numbers and hyphens."}>
          <Input
            id="lp-slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            className="font-mono"
          />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-fg">Product</p>
          <ProductPicker selected={product ? [product] : []} onChange={(list) => setProduct(list.at(-1) ?? null)} />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-fg">Start from</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {LANDING_TEMPLATE_KEYS.map((key) => {
              const t = LANDING_TEMPLATES[key];
              const on = template === key;
              return (
                <label
                  key={key}
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 transition-colors duration-base",
                    on ? "border-ink-900 bg-surface ring-1 ring-ink-900" : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  <input type="radio" name="lp-template" value={key} checked={on} onChange={() => setTemplate(key)} className="sr-only" />
                  <span className="text-sm font-semibold text-fg">{t.name}</span>
                  <span className="text-xs leading-relaxed text-fg-muted">{t.description}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
