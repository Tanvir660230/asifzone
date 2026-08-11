"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
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
import { PageHeader } from "@/components/admin/page-header";
import { SettingsSubNav } from "@/components/admin/settings-subnav";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
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
        {errors.fromPath && <p className="mt-1 text-xs text-danger-600">{errors.fromPath.message}</p>}
      </div>
      <div>
        <Label htmlFor="toPath">To path</Label>
        <Input id="toPath" placeholder="/product/new-product-slug" {...register("toPath")} />
        {errors.toPath && <p className="mt-1 text-xs text-danger-600">{errors.toPath.message}</p>}
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
  const { data, isLoading } = useQuery({ queryKey: ["admin-redirects"], queryFn: () => redirectsApi.listRedirects() });
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

  return (
    <div>
      <PageHeader
        title="Redirects"
        action={
          <Button variant="brass" onClick={() => setEditing("new")}>
            <Plus size={16} /> Add redirect
          </Button>
        }
      />
      <SettingsSubNav />
      <p className="mb-4 -mt-2 text-sm text-ink-500">
        Old URLs (e.g. after a product or category slug change) that should send visitors and search engines to a new location.
      </p>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <HScrollShadow className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={5} cols={5} />}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-400">
                    No redirects yet.
                  </td>
                </tr>
              )}
              {data?.items.map((r) => (
                <tr key={r.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                  <td className="px-4 py-3 font-mono text-xs">{r.fromPath}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-500">{r.toPath}</td>
                  <td className="px-4 py-3 text-ink-500">{r.statusCode}</td>
                  <td className="px-4 py-3">
                    <Badge className={r.isActive ? "bg-success-100 text-success-700" : ""}>{r.isActive ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      <button onClick={() => setEditing(r)} className="text-ink-500 hover:text-ink-900" aria-label="Edit">
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleDelete(r)} className="text-ink-500 hover:text-danger-600" aria-label="Delete">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScrollShadow>
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add redirect" : "Edit redirect"}>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        {editing !== null && (
          <RedirectForm initial={editing === "new" ? undefined : editing} onSubmit={handleSubmit} onCancel={() => setEditing(null)} />
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}
