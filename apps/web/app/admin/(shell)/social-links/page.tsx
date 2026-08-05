"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { createSocialLinkSchema, type CreateSocialLinkInput, type SocialLink } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/admin/page-header";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { SOCIAL_PLATFORM_META, SocialIcon } from "@/components/social-icon";
import * as socialLinksApi from "@/lib/api/admin-social-links";
import { ApiError } from "@/lib/api-client";

export default function SocialLinksPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-social-links"], queryFn: socialLinksApi.listSocialLinks });
  const [showCreate, setShowCreate] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-social-links"] });

  const createMutation = useMutation({ mutationFn: socialLinksApi.createSocialLink, onSuccess: invalidate });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof socialLinksApi.updateSocialLink>[1]) =>
      socialLinksApi.updateSocialLink(id, input),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: socialLinksApi.deleteSocialLink,
    onSuccess: () => {
      invalidate();
      toast.success("Social link deleted");
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateSocialLinkInput>({
    resolver: zodResolver(createSocialLinkSchema),
    defaultValues: { platform: "FACEBOOK", url: "", isActive: true, sortOrder: 0 },
  });
  const platform = watch("platform");

  const links = data?.links ?? [];

  async function onSubmit(values: CreateSocialLinkInput) {
    setFormError(null);
    try {
      await createMutation.mutateAsync({ ...values, sortOrder: links.length });
      setShowCreate(false);
      reset({ platform: "FACEBOOK", url: "", isActive: true, sortOrder: 0 });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to add social link");
    }
  }

  async function handleDelete(link: SocialLink) {
    if (!(await confirm(`Remove the ${SOCIAL_PLATFORM_META[link.platform].label} link?`))) return;
    await deleteMutation.mutateAsync(link.id);
  }

  function move(index: number, direction: -1 | 1) {
    const target = links[index + direction];
    const current = links[index];
    if (!target || !current) return;
    updateMutation.mutate({ id: current.id, sortOrder: target.sortOrder });
    updateMutation.mutate({ id: target.id, sortOrder: current.sortOrder });
  }

  return (
    <div>
      <PageHeader
        title="Social Links"
        action={
          <Button variant="brass" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Add link
          </Button>
        }
      />
      <p className="mb-4 text-sm text-ink-500">
        Shown as icons in the storefront footer, in the order below. Only active links appear on the site.
      </p>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        {isLoading && <p className="p-6 text-sm text-ink-400">Loading…</p>}
        {!isLoading && links.length === 0 && (
          <p className="p-6 text-sm text-ink-400">No social links yet — add one to show its icon in the footer.</p>
        )}
        {links.length > 0 && (
          <ul className="divide-y divide-ink-100">
            {links.map((link, index) => {
              const meta = SOCIAL_PLATFORM_META[link.platform];
              return (
                <li key={link.id} className="flex items-center gap-4 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-200 text-ink-700">
                    <SocialIcon platform={link.platform} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">{link.platform === "OTHER" ? link.label : meta.label}</p>
                    <p className="truncate text-xs text-ink-400">{link.url}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="rounded p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:pointer-events-none disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === links.length - 1}
                      className="rounded p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:pointer-events-none disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-xs text-ink-600">
                    <Checkbox
                      checked={link.isActive}
                      onChange={(e) => updateMutation.mutate({ id: link.id, isActive: e.target.checked })}
                    />
                    Active
                  </label>
                  <button onClick={() => handleDelete(link)} className="shrink-0 text-ink-400 hover:text-danger-600" aria-label="Delete">
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add social link">
        {formError && <p className="mb-3 text-sm text-danger-600">{formError}</p>}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="platform">Platform</Label>
            <Select id="platform" {...register("platform")}>
              {Object.entries(SOCIAL_PLATFORM_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </div>
          {platform === "OTHER" && (
            <div>
              <Label htmlFor="label">Label</Label>
              <Input id="label" placeholder="e.g. Pinterest" {...register("label")} />
              {errors.label && <p className="mt-1 text-xs text-danger-600">{errors.label.message}</p>}
            </div>
          )}
          <div>
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              placeholder={platform === "WHATSAPP" ? "https://wa.me/8801XXXXXXXXX" : "https://…"}
              {...register("url")}
            />
            {errors.url && <p className="mt-1 text-xs text-danger-600">{errors.url.message}</p>}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <Checkbox {...register("isActive")} defaultChecked />
            Show on storefront
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brass" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Add link"}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
