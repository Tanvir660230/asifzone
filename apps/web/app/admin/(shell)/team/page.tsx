"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ShieldOff, ShieldCheck, Pencil, KeyRound, Copy, Check, MoreHorizontal, LogOut, ShieldAlert, UserX } from "lucide-react";
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
import { ROLE_NAMES, RoleSummary } from "@/components/admin/role-summary";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow, TableSkeleton as RowsSkeleton } from "@/components/ui/table";
import { Modal } from "@/components/ui/modal";
import { PasswordInput } from "@/components/account/password-input";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import * as authApi from "@/lib/auth";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { ApiError } from "@/lib/api-client";
import { formatDateShort, timeAgo } from "@/lib/format";

function InviteForm({ onSubmit, onCancel }: { onSubmit: (values: CreateAdminInviteInput) => Promise<void>; onCancel: () => void }) {
  const {
    register,
    handleSubmit,
    watch,
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
        {errors.name && <p className="ui-field-error">{errors.name.message}</p>}
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email && <p className="ui-field-error">{errors.email.message}</p>}
      </div>
      <div>
        <Label htmlFor="role">Role</Label>
        <Select id="role" {...register("role")}>
          <option value="STAFF">Staff — runs the store, no books</option>
          <option value="MANAGER">Manager — store and books, not staff or settings</option>
          <option value="OWNER">Owner — everything</option>
          <option value="FINANCE_ADMIN">Finance admin (books only)</option>
          <option value="ACCOUNTANT">Accountant (books only — records, can&apos;t post)</option>
          <option value="FINANCE_VIEWER">Finance viewer (books only — read-only)</option>
        </Select>
        <div className="mt-2">
          <RoleSummary role={watch("role") ?? "STAFF"} />
        </div>
      </div>
      <p className="text-xs text-ink-500">
        They&rsquo;ll get an email with a link to set their own password — you won&rsquo;t need to share a password with them.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
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
    watch,
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
        {errors.name && <p className="ui-field-error">{errors.name.message}</p>}
      </div>
      <div>
        <Label htmlFor="edit-email">Email</Label>
        <Input id="edit-email" type="email" autoComplete="email" {...register("email")} />
        {errors.email && <p className="ui-field-error">{errors.email.message}</p>}
      </div>
      <div>
        <Label htmlFor="edit-role">Role</Label>
        <Select id="edit-role" {...register("role")}>
          <option value="STAFF">Staff — runs the store, no books</option>
          <option value="MANAGER">Manager — store and books, not staff or settings</option>
          <option value="OWNER">Owner — everything</option>
          <option value="FINANCE_ADMIN">Finance admin (books only)</option>
          <option value="ACCOUNTANT">Accountant (books only — records, can&apos;t post)</option>
          <option value="FINANCE_VIEWER">Finance viewer (books only — read-only)</option>
        </Select>
        <div className="mt-2">
          <RoleSummary role={watch("role") ?? "STAFF"} />
        </div>
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
        {errors.password && <p className="ui-field-error">{errors.password.message}</p>}
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

/** One teammate's actions, behind a ⋯ button: edit, password, 2-step reset, sign out everywhere, deactivate. */
function MemberMenu({ admin, isSelf, onEdit, onPassword, onResetTwoStep, onSignOut, onToggleActive }: {
  admin: authApi.AdminAccount;
  isSelf: boolean;
  onEdit: () => void;
  onPassword: () => void;
  onResetTwoStep: () => void;
  onSignOut: () => void;
  onToggleActive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const items: DropdownMenuItem[] = [
    { label: "Edit name, email, role", icon: Pencil, onClick: onEdit },
    { label: "Set a new password", icon: KeyRound, onClick: onPassword },
    ...(admin.twoStepEnabled && !isSelf ? [{ label: "Reset 2-step sign-in", icon: ShieldAlert, onClick: onResetTwoStep }] : []),
    ...((admin.activeSessions ?? 0) > 0 && !isSelf ? [{ label: "Sign out of every device", icon: LogOut, onClick: onSignOut }] : []),
    ...(isSelf ? [] : [{ label: admin.isActive ? "Deactivate" : "Reactivate", icon: admin.isActive ? UserX : ShieldCheck, onClick: onToggleActive, destructive: admin.isActive }]),
  ];
  return (
    <>
      <IconButton ref={ref} size="sm" variant="ghost" aria-label={`Actions for ${admin.name}`} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={16} />
      </IconButton>
      <DropdownMenu open={open} onClose={() => setOpen(false)} anchorRef={ref} items={items} label={`Actions for ${admin.name}`} />
    </>
  );
}

/** After an invite: its link, to send by WhatsApp or any chat. When the email couldn't go out it's the only way in, and
 * the panel says why. */
function InviteLinkPanel({ result, onDone }: { result: { email: string; emailSent: boolean; acceptUrl: string }; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(result.acceptUrl);
      setCopied(true);
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't copy — select the link and copy it");
    }
  }
  return (
    <div className="space-y-4" data-testid="invite-link-panel">
      {result.emailSent ? (
        <p className="text-sm text-ink-600">
          We emailed an invite to <strong className="font-medium text-ink-900">{result.email}</strong>. You can also send them this link yourself.
        </p>
      ) : (
        <div className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2.5 text-sm text-warning-700" role="status">
          The invite is ready, but the email to <strong className="font-medium">{result.email}</strong> couldn&rsquo;t be sent (the store&rsquo;s email
          sending isn&rsquo;t fully set up). Send them this link on WhatsApp or another chat — it works for 7 days.
        </div>
      )}
      <div>
        <Label htmlFor="invite-link">Invite link</Label>
        <div className="mt-1 flex gap-2">
          <Input id="invite-link" readOnly value={result.acceptUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Button type="button" variant="outline" onClick={copy} className="shrink-0">
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
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
  const [inviteResult, setInviteResult] = useState<{ email: string; emailSent: boolean; acceptUrl: string } | null>(null);
  const [editingAdmin, setEditingAdmin] = useState<authApi.AdminAccount | null>(null);
  const [passwordAdmin, setPasswordAdmin] = useState<authApi.AdminAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  // Roles holding every permission (from the API's role catalog, not a role name compared here): without 2-step sign-in
  // they are the accounts worth flagging.
  const fullAccess = new Set((adminsData?.roles ?? []).filter((r) => r.kind === "ALL").map((r) => r.role));
  const ownersWithoutTwoStep = (adminsData?.admins ?? []).filter((a) => fullAccess.has(a.role) && a.isActive && a.twoStepEnabled === false);

  const inviteMutation = useMutation({
    mutationFn: authApi.createAdminInvite,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
      if (result.emailSent) toast.success("Invite sent");
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
  const resetTwoStepMutation = useMutation({
    mutationFn: (id: string) => authApi.resetAdminTwoStep(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-team"] });
      toast.success("2-step sign-in reset — they sign in with their password and can set it up again");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't reset 2-step sign-in"),
  });
  const signOutMutation = useMutation({
    mutationFn: (id: string) => authApi.revokeAllAdminSessions(id),
    onSuccess: ({ revoked }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-team"] });
      toast.success(revoked === 1 ? "Signed out of 1 device" : `Signed out of ${revoked} devices`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't sign them out"),
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
      const result = await inviteMutation.mutateAsync(values);
      setInviting(false);
      setInviteResult({ email: values.email, emailSent: result.emailSent, acceptUrl: result.acceptUrl });
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

  async function handleResetTwoStep(admin: authApi.AdminAccount) {
    if (!(await confirm(`Reset ${admin.name}'s 2-step sign-in? They'll be signed out, can sign in with just their password, and should set it up again.`))) return;
    resetTwoStepMutation.mutate(admin.id);
  }

  async function handleSignOut(admin: authApi.AdminAccount) {
    if (!(await confirm(`Sign ${admin.name} out of every device?`))) return;
    signOutMutation.mutate(admin.id);
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
          <Button onClick={() => setInviting(true)}>
            <Plus size={16} /> Invite admin
          </Button>
        }
      />
      <ModuleTabs />
      <p data-page-intro="" className="mb-4 -mt-2 text-sm text-fg-muted">
        Who can open the Store Console. Accounts only ever come from an invite sent here — there&rsquo;s no public sign-up.
      </p>

      {ownersWithoutTwoStep.length > 0 && (
        <Card className="mb-4 flex items-start gap-3 p-4" data-testid="team-two-step-nudge">
          <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-warning-600" aria-hidden />
          <p className="text-sm text-fg">
            {ownersWithoutTwoStep.map((a) => a.name).join(", ")} {ownersWithoutTwoStep.length === 1 ? "is an owner" : "are owners"} without 2-step sign-in.
            <span className="text-fg-muted"> Owners can see everything — turn it on from the account menu (top right) › 2-step sign-in.</span>
          </p>
        </Card>
      )}

      <TableContainer>
        <Table className="min-w-[760px]" data-testid="team-table">
          <TableHead>
            <tr>
              <TableHeaderCell>Member</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>2-step</TableHeaderCell>
              <TableHeaderCell>Last active</TableHeaderCell>
              <TableHeaderCell align="right">Sessions</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell align="right"><span className="sr-only">Actions</span></TableHeaderCell>
            </tr>
          </TableHead>
          <tbody>
            {adminsLoading && <RowsSkeleton rows={3} cols={7} />}
            {adminsData?.admins.map((admin) => {
              const isSelf = admin.id === currentAdmin?.admin.id;
              return (
                <TableRow key={admin.id}>
                  <TableCell data-cell="title">
                    <span className="block font-medium text-fg">{admin.name}{isSelf && <span className="font-normal text-fg-muted"> (you)</span>}</span>
                    <span className="block text-xs text-fg-muted">{admin.email}</span>
                  </TableCell>
                  <TableCell>{ROLE_NAMES[admin.role] ?? admin.role}</TableCell>
                  <TableCell data-cell="badge">
                    <Badge variant={admin.twoStepEnabled ? "success" : fullAccess.has(admin.role) ? "warning" : "neutral"} dot>
                      {admin.twoStepEnabled ? "On" : "Off"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-fg-muted" title={admin.lastActiveAt ?? undefined}>
                    {admin.lastActiveAt ? timeAgo(admin.lastActiveAt) : "Never"}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">{admin.activeSessions ?? 0}</TableCell>
                  <TableCell data-cell="badge">
                    <Badge variant={admin.isActive ? "neutral" : "danger"}>{admin.isActive ? `Joined ${formatDateShort(new Date(admin.createdAt))}` : "Deactivated"}</Badge>
                  </TableCell>
                  <TableCell align="right" data-cell="action">
                    <MemberMenu
                      admin={admin}
                      isSelf={isSelf}
                      onEdit={() => setEditingAdmin(admin)}
                      onPassword={() => setPasswordAdmin(admin)}
                      onResetTwoStep={() => handleResetTwoStep(admin)}
                      onSignOut={() => handleSignOut(admin)}
                      onToggleActive={() => handleToggleActive(admin)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </Table>
      </TableContainer>

      {(invitesLoading || (invitesData && invitesData.invites.length > 0)) && (
        <>
          <h2 className="mb-3 mt-8 text-[17px] font-semibold tracking-tight text-fg">Pending invites</h2>
          <TableContainer>
            <Table className="min-w-[560px]">
              <TableHead>
                <tr>
                  <TableHeaderCell>Invited</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Expires</TableHeaderCell>
                  <TableHeaderCell align="right"><span className="sr-only">Actions</span></TableHeaderCell>
                </tr>
              </TableHead>
              <tbody>
                {invitesLoading && <RowsSkeleton rows={2} cols={4} />}
                {invitesData?.invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell data-cell="title">
                      <span className="block font-medium text-fg">{invite.name}</span>
                      <span className="block text-xs text-fg-muted">{invite.email}</span>
                    </TableCell>
                    <TableCell>{ROLE_NAMES[invite.role] ?? invite.role}</TableCell>
                    <TableCell className="text-fg-muted">{formatDateShort(new Date(invite.expiresAt))}</TableCell>
                    <TableCell align="right" data-cell="action">
                      <IconButton size="sm" variant="ghost" onClick={() => handleRevokeInvite(invite.id, invite.email)} aria-label={`Revoke the invite for ${invite.email}`}>
                        <Trash2 size={16} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          </TableContainer>
        </>
      )}

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invite admin">
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <InviteForm onSubmit={handleInvite} onCancel={() => setInviting(false)} />
      </Modal>

      <Modal open={Boolean(inviteResult)} onClose={() => setInviteResult(null)} title={inviteResult?.emailSent ? "Invite sent" : "Send this invite link"}>
        {inviteResult && <InviteLinkPanel result={inviteResult} onDone={() => setInviteResult(null)} />}
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
