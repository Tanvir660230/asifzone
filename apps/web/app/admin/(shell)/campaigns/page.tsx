"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, XCircle, Pencil, Trash2 } from "lucide-react";
import { createCampaignSchema, type Campaign, type CreateCampaignInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { PromotionsSubNav } from "@/components/admin/promotions-subnav";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import * as campaignsApi from "@/lib/api/admin-campaigns";
import { uploadEditorImage } from "@/lib/api/uploads";
import { ApiError } from "@/lib/api-client";

// Tiptap + its ~9 sub-packages are large and admin-only — split out of the main bundle and only
// fetched once an EMAIL campaign's body field actually renders it (see below).
const RichTextEditor = dynamic(
  () => import("@/components/admin/rich-text-editor").then((m) => m.RichTextEditor),
  { ssr: false },
);

const STATUS_COLOR: Record<Campaign["status"], string> = {
  DRAFT: "bg-ink-100 text-ink-600",
  SCHEDULED: "bg-info-100 text-info-700",
  SENDING: "bg-brass-100 text-brass-700",
  SENT: "bg-success-100 text-success-700",
  FAILED: "bg-danger-100 text-danger-700",
};

const SEGMENT_OPTIONS: Array<{ value: CreateCampaignInput["segmentType"]; label: string }> = [
  { value: "ALL_CUSTOMERS", label: "All customers" },
  { value: "NEWSLETTER_SUBSCRIBERS", label: "Newsletter subscribers" },
  { value: "CUSTOMERS_WITH_ORDERS", label: "Customers with at least one order" },
  { value: "CUSTOMERS_NO_ORDER_30D", label: "No order in the last 30 days" },
];

export default function CampaignsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-campaigns"], queryFn: () => campaignsApi.listCampaigns() });
  const [showCompose, setShowCompose] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ["admin-campaigns"] });
  }

  const createMutation = useMutation({ mutationFn: campaignsApi.createCampaign, onSuccess: invalidate });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateCampaignInput }) => campaignsApi.updateCampaign(id, input),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: campaignsApi.deleteCampaign,
    onSuccess: () => {
      invalidate();
      toast.success("Campaign deleted");
    },
  });
  const sendMutation = useMutation({
    mutationFn: campaignsApi.sendCampaignNow,
    onSuccess: () => {
      invalidate();
      toast.success("Campaign is sending");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to send campaign"),
  });
  const cancelScheduleMutation = useMutation({
    mutationFn: campaignsApi.cancelCampaignSchedule,
    onSuccess: () => {
      invalidate();
      toast.success("Schedule cancelled");
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateCampaignInput>({
    resolver: zodResolver(createCampaignSchema),
    defaultValues: { channel: "EMAIL", segmentType: "ALL_CUSTOMERS" },
  });
  const channel = watch("channel");

  function openCreate() {
    setEditing(null);
    reset({ channel: "EMAIL", segmentType: "ALL_CUSTOMERS", name: "", subject: "", body: "" });
    setError(null);
    setShowCompose(true);
  }

  function openEdit(campaign: Campaign) {
    setEditing(campaign);
    reset({
      name: campaign.name,
      channel: campaign.channel,
      subject: campaign.subject ?? "",
      body: campaign.body,
      segmentType: (campaign.segment?.filter.type as CreateCampaignInput["segmentType"]) ?? "ALL_CUSTOMERS",
    });
    setError(null);
    setShowCompose(true);
  }

  async function onSubmit(values: CreateCampaignInput) {
    setError(null);
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, input: values });
      } else {
        await createMutation.mutateAsync(values);
      }
      setShowCompose(false);
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save campaign");
    }
  }

  async function handleDelete(campaign: Campaign) {
    if (!(await confirm(`Delete campaign "${campaign.name}"? This can't be undone.`))) return;
    await deleteMutation.mutateAsync(campaign.id);
  }

  async function handleSendNow(campaign: Campaign) {
    if (!(await confirm(`Send "${campaign.name}" now to its full audience?`))) return;
    await sendMutation.mutateAsync(campaign.id);
  }

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Compose and schedule email/SMS/push sends to a saved customer audience."
        action={
          <Button variant="brass" onClick={openCreate}>
            <Plus size={16} /> New campaign
          </Button>
        }
      />

      <PromotionsSubNav />

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <HScrollShadow className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Audience</th>
                <th className="px-4 py-3">Recipients</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Scheduled</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={5} cols={7} />}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-400">
                    No campaigns yet.
                  </td>
                </tr>
              )}
              {data?.items.map((c) => (
                <tr key={c.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-ink-500">{c.channel}</td>
                  <td className="px-4 py-3 text-ink-500">{c.segment?.name.split(" — ")[1] ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-500">{c.recipientCount}</td>
                  <td className="px-4 py-3">
                    <Badge className={STATUS_COLOR[c.status]}>{c.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-500">
                    {c.scheduledAt ? new Date(c.scheduledAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {(c.status === "DRAFT" || c.status === "SCHEDULED") && (
                        <button
                          title="Send now"
                          onClick={() => handleSendNow(c)}
                          className="text-ink-400 hover:text-brass-600"
                        >
                          <Send size={16} />
                        </button>
                      )}
                      {c.status === "DRAFT" && (
                        <button title="Edit" onClick={() => openEdit(c)} className="text-ink-400 hover:text-ink-900">
                          <Pencil size={16} />
                        </button>
                      )}
                      {c.status === "SCHEDULED" && (
                        <button
                          title="Cancel schedule"
                          onClick={() => cancelScheduleMutation.mutateAsync(c.id)}
                          className="text-ink-400 hover:text-danger-600"
                        >
                          <XCircle size={16} />
                        </button>
                      )}
                      {c.status === "DRAFT" && (
                        <button title="Delete" onClick={() => handleDelete(c)} className="text-ink-400 hover:text-danger-600">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScrollShadow>
      </div>

      <Modal open={showCompose} onClose={() => setShowCompose(false)} title={editing ? "Edit campaign" : "New campaign"}>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="August restock announcement" {...register("name")} />
            {errors.name && <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="channel">Channel</Label>
              <Select id="channel" {...register("channel")}>
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
                <option value="PUSH">Push notification</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="segmentType">Audience</Label>
              <Select id="segmentType" {...register("segmentType")}>
                {SEGMENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="subject">Subject / title</Label>
            <Input id="subject" placeholder="Used as the email subject or push title" {...register("subject")} />
          </div>

          <div>
            <Label htmlFor="body">Message</Label>
            {channel === "EMAIL" ? (
              <Controller
                name="body"
                control={control}
                render={({ field }) => (
                  <RichTextEditor value={field.value ?? ""} onChange={field.onChange} uploadImage={uploadEditorImage} />
                )}
              />
            ) : (
              <Textarea
                id="body"
                rows={6}
                placeholder={channel === "SMS" ? "Plain text — keep it short" : "Plain text"}
                {...register("body")}
              />
            )}
            {errors.body && <p className="mt-1 text-xs text-danger-600">{errors.body.message}</p>}
          </div>

          {!editing && (
            <div>
              <Label htmlFor="scheduledAt">Schedule for (optional)</Label>
              <Input id="scheduledAt" type="datetime-local" {...register("scheduledAt")} />
              <p className="mt-1 text-xs text-ink-400">Leave blank to save as a draft you can send later.</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowCompose(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brass" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : editing ? "Save changes" : "Save campaign"}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </div>
  );
}
