"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, CornerDownRight } from "lucide-react";
import { createRedirectSchema, type CreateRedirectInput, type Redirect } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { ListPage } from "@/components/admin/patterns/list-page";
import { DataTable, type DataTableColumn, type DataTableRowAction } from "@/components/admin/data-table";
import * as redirectsApi from "@/lib/api/admin-redirects";
import { ApiError } from "@/lib/api-client";

function RedirectForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Redirect;
  onSubmit: (values: CreateRedirectInput) => Promise<void>;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateRedirectInput>({
    resolver: zodResolver(createRedirectSchema),
    defaultValues: initial
      ? { fromPath: initial.fromPath, toPath: initial.toPath, statusCode: initial.statusCode as 301 | 302, isActive: initial.isActive }
      : { statusCode: 301, isActive: true },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="fromPath">From path</Label>
        <Input id="fromPath" placeholder="/old-product-slug" {...register("fromPath")} />
        {errors.fromPath && <p className="ui-field-error">{errors.fromPath.message}</p>}
      </div>
      <div>
        <Label htmlFor="toPath">To path</Label>
        <Input id="toPath" placeholder="/product/new-product-slug" {...register("toPath")} />
        {errors.toPath && <p className="ui-field-error">{errors.toPath.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="statusCode">Status code</Label>
          <Select id="statusCode" {...register("statusCode", { valueAsNumber: true })}>
            <option value={301}>301 (Permanent)</option>
            <option value={302}>302 (Temporary)</option>
          </Select>
        </div>
        <label className="flex items-center gap-2 pt-6 text-sm text-ink-700">
          <Checkbox {...register("isActive")} />
          Active
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brass" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save redirect"}
        </Button>
      </div>
    </form>
  );
}

export default function AdminRedirectsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error: loadError, refetch } = useQuery({ queryKey: ["admin-redirects"], queryFn: () => redirectsApi.listRedirects() });
  const [editing, setEditing] = useState<Redirect | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: redirectsApi.createRedirect,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-redirects"] }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateRedirectInput }) => redirectsApi.updateRedirect(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-redirects"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: redirectsApi.deleteRedirect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-redirects"] });
      toast.success("Redirect deleted");
    },
  });
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  async function handleSubmit(values: CreateRedirectInput) {
    setError(null);
    try {
      if (editing && editing !== "new") {
        await updateMutation.mutateAsync({ id: editing.id, input: values });
      } else {
        await createMutation.mutateAsync(values);
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save redirect");
    }
  }

  async function handleDelete(redirect: Redirect) {
    if (!(await confirm(`Delete the redirect from "${redirect.fromPath}"?`))) return;
    await deleteMutation.mutateAsync(redirect.id);
  }

  const columns: DataTableColumn<Redirect>[] = [
    { id: "from", header: "From", card: "title", cell: (r) => <span className="break-all font-mono text-xs text-ink-900">{r.fromPath}</span> },
    { id: "to", header: "To", cell: (r) => <span className="break-all font-mono text-xs text-ink-500">{r.toPath}</span> },
    { id: "code", header: "Type", className: "w-24", cell: (r) => <span className="tabular-nums text-ink-500">{r.statusCode}</span> },
    { id: "active", header: "Status", className: "w-28", cell: (r) => <Badge variant={r.isActive ? "success" : "neutral"}>{r.isActive ? "Active" : "Inactive"}</Badge> },
  ];
  const rowActions = (r: Redirect): DataTableRowAction<Redirect>[] => [
    { label: "Edit", icon: Pencil, onSelect: () => setEditing(r) },
    { label: "Delete", icon: Trash2, destructive: true, onSelect: () => void handleDelete(r) },
  ];

  return (
    <ListPage
      title="Redirects"
      action={
        <Button variant="brass" onClick={() => setEditing("new")}>
          <Plus size={16} /> Add redirect
        </Button>
      }
      intro={
        <>
          Old URLs (e.g. after a product or category slug change) that should send visitors and search engines to a new location.
        </>
      }
    >
      <DataTable<Redirect>
        caption="Redirects"
        columns={columns}
        rows={isLoading ? undefined : data?.items}
        getRowId={(row) => row.id}
        loading={isLoading}
        error={loadError}
        onRetry={() => void refetch()}
        empty={<EmptyState icon={CornerDownRight} title="No redirects yet" description="Send visitors from an old link to the right page." variant="bordered" />}
        density="dense"
        onRowOpen={setEditing}
        rowActions={rowActions}
      />

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add redirect" : "Edit redirect"}>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {editing !== null && (
          <RedirectForm initial={editing === "new" ? undefined : editing} onSubmit={handleSubmit} onCancel={() => setEditing(null)} />
        )}
      </Modal>
      {confirmDialog}
    </ListPage>
  );
}
