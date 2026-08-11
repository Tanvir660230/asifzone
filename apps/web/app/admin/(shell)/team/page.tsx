"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ShieldOff, ShieldCheck, Pencil, KeyRound } from "lucide-react";
import {
  createAdminInviteSchema,
  updateAdminSchema,
  setAdminPasswordSchema,
  type CreateAdminInviteInput,
  type UpdateAdminInput,
  type SetAdminPasswordInput,
} from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { PasswordInput } from "@/components/account/password-input";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { SettingsSubNav } from "@/components/admin/settings-subnav";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import * as authApi from "@/lib/auth";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { ApiError } from "@/lib/api-client";
import { formatDateShort } from "@/lib/format";

function InviteForm({ onSubmit, onCancel }: { onSubmit: (values: CreateAdminInviteInput) => Promise<void>; onCancel: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateAdminInviteInput>({
    resolver: zodResolver(createAdminInviteSchema),
    defaultValues: { role: "STAFF" },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">Full name</Label>
        <Input id="name" autoComplete="name" {...register("name")} />
        {errors.name && <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>}
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email && <p className="mt-1 text-xs text-danger-600">{errors.email.message}</p>}
      </div>
      <div>
        <Label htmlFor="role">Role</Label>
        <Select id="role" {...register("role")}>
          <option value="STAFF">Staff</option>
          <option value="OWNER">Owner (super admin)</option>
        </Select>
      </div>
      <p className="text-xs text-ink-500">
        They&rsquo;ll get an email with a link to set their own password — you won&rsquo;t need to share a password with them.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brass" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send invite"}
        </Button>
      </div>
    </form>
  );
}

function EditAdminForm({
  admin,
  onSubmit,
  onCancel,
}: {
  admin: authApi.AdminAccount;
  onSubmit: (values: UpdateAdminInput) => Promise<void>;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateAdminInput>({
    resolver: zodResolver(updateAdminSchema),
    defaultValues: { name: admin.name, email: admin.email, role: admin.role },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="edit-name">Full name</Label>
        <Input id="edit-name" autoComplete="name" {...register("name")} />
        {errors.name && <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>}
      </div>
      <div>
        <Label htmlFor="edit-email">Email</Label>
        <Input id="edit-email" type="email" autoComplete="email" {...register("email")} />
        {errors.email && <p className="mt-1 text-xs text-danger-600">{errors.email.message}</p>}
      </div>
      <div>
        <Label htmlFor="edit-role">Role</Label>
        <Select id="edit-role" {...register("role")}>
          <option value="STAFF">Staff</option>
          <option value="OWNER">Owner (super admin)</option>
        </Select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function SetPasswordForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (values: SetAdminPasswordInput) => Promise<void>;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SetAdminPasswordInput>({ resolver: zodResolver(setAdminPasswordSchema) });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="new-password">New password</Label>
        <PasswordInput id="new-password" autoComplete="new-password" {...register("password")} />
        {errors.password && <p className="mt-1 text-xs text-danger-600">{errors.password.message}</p>}
      </div>
      <p className="text-xs text-ink-500">They&rsquo;ll be signed out everywhere and need to log in again with this password.</p>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Set password"}
        </Button>
      </div>
    </form>
  );
}

export default function AdminTeamPage() {
  const queryClient = useQueryClient();
  const { data: currentAdmin } = useCurrentAdmin();
  const { data: adminsData, isLoading: adminsLoading } = useQuery({ queryKey: ["admin-team"], queryFn: authApi.listAdmins });
  const { data: invitesData, isLoading: invitesLoading } = useQuery({
    queryKey: ["admin-invites"],
    queryFn: authApi.listAdminInvites,
  });
  const [inviting, setInviting] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<authApi.AdminAccount | null>(null);
  const [passwordAdmin, setPasswordAdmin] = useState<authApi.AdminAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const inviteMutation = useMutation({
    mutationFn: authApi.createAdminInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
      toast.success("Invite sent");
    },
  });
  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => authApi.setAdminActive(id, isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-team"] }),
  });
  const revokeInviteMutation = useMutation({
    mutationFn: authApi.revokeAdminInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
      toast.success("Invite revoked");
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: UpdateAdminInput }) => authApi.updateAdmin(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-team"] });
      queryClient.invalidateQueries({ queryKey: ["current-admin"] });
      toast.success("Team member updated");
      setEditingAdmin(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update team member"),
  });
  const passwordMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => authApi.setAdminPassword(id, password),
    onSuccess: () => {
      toast.success("Password updated");
      setPasswordAdmin(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update password"),
  });

  async function handleInvite(values: CreateAdminInviteInput) {
    setError(null);
    try {
      await inviteMutation.mutateAsync(values);
      setInviting(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send invite");
    }
  }

  async function handleToggleActive(admin: authApi.AdminAccount) {
    const verb = admin.isActive ? "Deactivate" : "Reactivate";
    if (!(await confirm(`${verb} ${admin.name}'s account?`))) return;
    try {
      await activeMutation.mutateAsync({ id: admin.id, isActive: !admin.isActive });
      toast.success(`${admin.name} ${admin.isActive ? "deactivated" : "reactivated"}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update account");
    }
  }

  async function handleRevokeInvite(inviteId: string, email: string) {
    if (!(await confirm(`Revoke the invite for ${email}?`))) return;
    await revokeInviteMutation.mutateAsync(inviteId);
  }

  return (
    <div>
      <PageHeader
        title="Team"
        action={
          <Button variant="brass" onClick={() => setInviting(true)}>
            <Plus size={16} /> Invite admin
          </Button>
        }
      />
      <SettingsSubNav />
      <p className="mb-4 -mt-2 text-sm text-ink-500">
        Admin accounts only ever come from an invite sent here — there&rsquo;s no public sign-up for the console.
      </p>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <HScrollShadow className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {adminsLoading && <TableSkeleton rows={3} cols={6} />}
              {adminsData?.admins.map((admin) => (
                <tr key={admin.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                  <td className="px-4 py-3">{admin.name}</td>
                  <td className="px-4 py-3 text-ink-500">{admin.email}</td>
                  <td className="px-4 py-3">
                    <Badge className={admin.role === "OWNER" ? "bg-brass-100 text-brass-700" : ""}>
                      {admin.role === "OWNER" ? "Super admin" : "Staff"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={admin.isActive ? "bg-success-100 text-success-700" : "bg-danger-100 text-danger-700"}>
                      {admin.isActive ? "Active" : "Deactivated"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-500">{formatDateShort(new Date(admin.createdAt))}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => setEditingAdmin(admin)}
                        className="text-ink-500 hover:text-ink-900"
                        aria-label="Edit"
                        title="Edit name, email, role"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setPasswordAdmin(admin)}
                        className="text-ink-500 hover:text-ink-900"
                        aria-label="Set password"
                        title="Set password"
                      >
                        <KeyRound size={16} />
                      </button>
                      {admin.id !== currentAdmin?.admin.id && (
                        <button
                          onClick={() => handleToggleActive(admin)}
                          className="text-ink-500 hover:text-ink-900"
                          aria-label={admin.isActive ? "Deactivate" : "Reactivate"}
                          title={admin.isActive ? "Deactivate" : "Reactivate"}
                        >
                          {admin.isActive ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}
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

      {(invitesLoading || (invitesData && invitesData.invites.length > 0)) && (
        <>
          <h2 className="mb-3 mt-8 font-display text-lg text-ink-900">Pending invites</h2>
          <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
            <HScrollShadow className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invitesLoading && <TableSkeleton rows={2} cols={5} />}
                  {invitesData?.invites.map((invite) => (
                    <tr key={invite.id} className="border-t border-ink-100">
                      <td className="px-4 py-3">{invite.name}</td>
                      <td className="px-4 py-3 text-ink-500">{invite.email}</td>
                      <td className="px-4 py-3">{invite.role === "OWNER" ? "Super admin" : "Staff"}</td>
                      <td className="px-4 py-3 text-ink-500">{formatDateShort(new Date(invite.expiresAt))}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <button
                            onClick={() => handleRevokeInvite(invite.id, invite.email)}
                            className="text-ink-500 hover:text-danger-600"
                            aria-label="Revoke invite"
                          >
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
        </>
      )}

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invite admin">
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <InviteForm onSubmit={handleInvite} onCancel={() => setInviting(false)} />
      </Modal>

      <Modal open={Boolean(editingAdmin)} onClose={() => setEditingAdmin(null)} title="Edit team member">
        {editingAdmin && (
          <EditAdminForm
            admin={editingAdmin}
            onCancel={() => setEditingAdmin(null)}
            onSubmit={async (values) => {
              await updateMutation.mutateAsync({ id: editingAdmin.id, values });
            }}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(passwordAdmin)}
        onClose={() => setPasswordAdmin(null)}
        title={passwordAdmin ? `Set password for ${passwordAdmin.name}` : "Set password"}
      >
        {passwordAdmin && (
          <SetPasswordForm
            onCancel={() => setPasswordAdmin(null)}
            onSubmit={({ password }) => passwordMutation.mutateAsync({ id: passwordAdmin.id, password })}
          />
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
