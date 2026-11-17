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
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { DataTable, type DataTableColumn, type DataTableRowAction } from "@/components/admin/data-table";
import * as campaignsApi from "@/lib/api/admin-campaigns";
import { formatStoreDateTime } from "@/lib/format";
import { uploadEditorImage } from "@/lib/api/uploads";
import { ApiError } from "@/lib/api-client";
import { useProviderCapabilities } from "@/hooks/use-provider-capabilities";

// Tiptap + its ~9 sub-packages are large and admin-only — split out of the main bundle and only
// fetched once an EMAIL campaign's body field actually renders it (see below).
const RichTextEditor = dynamic(
  () => import("@/components/admin/rich-text-editor").then((m) => m.RichTextEditor),
  { ssr: false },
);

const STATUS_VARIANT: Record<Campaign["status"], "neutral" | "success" | "info" | "warning" | "danger" | "accent"> = {
  DRAFT: "neutral",
  SCHEDULED: "info",
  SENDING: "accent",
  SENT: "success",
  FAILED: "danger",
};

const SEGMENT_OPTIONS: Array<{ value: CreateCampaignInput["segmentType"]; label: string }> = [
  { value: "ALL_CUSTOMERS", label: "All customers" },
  { value: "NEWSLETTER_SUBSCRIBERS", label: "Newsletter subscribers" },
  { value: "CUSTOMERS_WITH_ORDERS", label: "Customers with at least one order" },
  { value: "CUSTOMERS_NO_ORDER_30D", label: "No order in the last 30 days" },
];

export default function CampaignsPage() {
  const channels = useProviderCapabilities(); // Phase 12 D-4: a channel without a configured provider can't be chosen
  const queryClient = useQueryClient();
  const { data, isLoading, error: loadError, refetch } = useQuery({ queryKey: ["admin-campaigns"], queryFn: () => campaignsApi.listCampaigns() });
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

  const columns: DataTableColumn<Campaign>[] = [
    { id: "name", header: "Name", card: "title", cell: (c) => <span className="font-medium text-ink-900">{c.name}</span> },
    { id: "channel", header: "Channel", cell: (c) => <span className="text-ink-500">{c.channel}</span> },
    { id: "audience", header: "Audience", cell: (c) => <span className="text-ink-500">{c.segment?.name.split(" — ")[1] ?? "—"}</span> },
    { id: "recipients", header: "Recipients", align: "right", className: "w-28", cell: (c) => <span className="tabular-nums text-ink-600">{c.recipientCount}</span> },
    { id: "status", header: "Status", cell: (c) => <Badge variant={STATUS_VARIANT[c.status]}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge> },
    { id: "scheduled", header: "Scheduled", cell: (c) => <span className="text-ink-500">{c.scheduledAt ? formatStoreDateTime(c.scheduledAt) : "—"}</span> },
  ];
  const rowActions = (c: Campaign): DataTableRowAction<Campaign>[] => [
    ...(c.status === "DRAFT" || c.status === "SCHEDULED" ? [{ label: "Send now", icon: Send, onSelect: () => void handleSendNow(c) }] : []),
    ...(c.status === "DRAFT" ? [{ label: "Edit", icon: Pencil, onSelect: () => openEdit(c) }] : []),
    ...(c.status === "SCHEDULED" ? [{ label: "Cancel schedule", icon: XCircle, destructive: true, onSelect: () => void cancelScheduleMutation.mutateAsync(c.id) }] : []),
    ...(c.status === "DRAFT" ? [{ label: "Delete", icon: Trash2, destructive: true, onSelect: () => void handleDelete(c) }] : []),
  ];

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

      <ModuleTabs />

      <DataTable<Campaign>
        caption="Campaigns"
        columns={columns}
        rows={isLoading ? undefined : data?.items}
        getRowId={(row) => row.id}
        loading={isLoading}
        error={loadError}
        onRetry={() => void refetch()}
        empty={<EmptyState icon={Send} title="No campaigns yet" description="Send an SMS or email to a group of customers, now or at a set time." variant="bordered" />}
        density="dense"
        onRowOpen={(c) => c.status === "DRAFT" && openEdit(c)}
        rowActions={rowActions}
      />

      <Modal open={showCompose} onClose={() => setShowCompose(false)} title={editing ? "Edit campaign" : "New campaign"}>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="August restock announcement" {...register("name")} />
            {errors.name && <p className="ui-field-error">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="channel">Channel</Label>
              <Select id="channel" {...register("channel")}>
                <option value="EMAIL" disabled={!channels.email}>Email{channels.loaded && !channels.email ? " (not configured)" : ""}</option>
                <option value="SMS" disabled={!channels.sms}>SMS{channels.loaded && !channels.sms ? " (not configured)" : ""}</option>
                <option value="PUSH" disabled={!channels.push}>Push notification{channels.loaded && !channels.push ? " (not configured)" : ""}</option>
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
            {errors.body && <p className="ui-field-error">{errors.body.message}</p>}
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
