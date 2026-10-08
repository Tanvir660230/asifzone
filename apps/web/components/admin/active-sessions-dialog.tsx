"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Smartphone } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { describeApiError } from "@/lib/api-client";
import { listAdminSessions, revokeAdminSession, revokeOtherAdminSessions, type AdminSession } from "@/lib/auth";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatStoreDateTime } from "@/lib/format";
import { describeDevice } from "@/lib/device-label";

const sessionsKey = ["admin-sessions"] as const;

/** Account › Active sessions (Blueprint V2 security): where I'm signed in, and signing one of the others out. */
export function ActiveSessionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: sessionsKey, queryFn: listAdminSessions, enabled: open });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeAdminSession(id),
    onSuccess: () => {
      toast.success("Signed out on that device");
      queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't sign that device out")),
  });
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const revokeOthers = useMutation({
    mutationFn: revokeOtherAdminSessions,
    onSuccess: ({ revoked }) => {
      toast.success(revoked === 1 ? "Signed out 1 other device" : `Signed out ${revoked} other devices`);
      queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't sign the other devices out")),
  });
  const sessions = data?.sessions ?? [];
  const others = sessions.filter((s) => !s.current).length;
  const signOutOthers = async () => {
    if (await confirm(`Sign out ${others === 1 ? "the other device" : `all ${others} other devices`}? This one stays signed in.`)) revokeOthers.mutate();
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Active sessions"
        description="Browsers and devices signed in as you. Sign out any you don't recognise."
        widthClassName="max-w-lg"
        footer={
          others > 0 ? (
            <Button variant="outline" onClick={signOutOthers} disabled={revokeOthers.isPending}>
              {revokeOthers.isPending ? "Signing out…" : others === 1 ? "Sign out the other device" : `Sign out all ${others} other devices`}
            </Button>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState description="We couldn't load your sessions." onRetry={() => refetch()} />
        ) : sessions.length === 0 ? (
          <EmptyState icon={Monitor} title="No active sessions" description="Nothing is signed in as you right now." />
        ) : (
          <ul className="-mx-1 max-h-[min(26rem,55vh)] divide-y divide-line-subtle overflow-y-auto px-1">
            {sessions.map((s: AdminSession) => {
              const device = describeDevice(s.userAgent);
              const Icon = device.phone ? Smartphone : Monitor;
              const pending = revoke.isPending && revoke.variables === s.id;
              return (
                <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-muted">
                    <Icon size={17} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                      {device.label}
                      {s.current && <Badge variant="success">This device</Badge>}
                    </p>
                    <p className="text-[13px] text-fg-muted">Signed in {formatStoreDateTime(s.createdAt)}</p>
                  </div>
                  {!s.current && (
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => revoke.mutate(s.id)} aria-label={`Sign out ${device.label}`}>
                      {pending ? "Signing out…" : "Sign out"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
      {confirmDialog}
    </>
  );
}
