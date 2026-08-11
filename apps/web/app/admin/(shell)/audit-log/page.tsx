"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/admin/page-header";
import { SettingsSubNav } from "@/components/admin/settings-subnav";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Pagination } from "@/components/admin/pagination";
import * as auditApi from "@/lib/api/audit";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

const ACTION_COLOR: Record<string, string> = {
  create: "bg-success-100 text-success-700",
  update: "bg-info-100 text-info-700",
  delete: "bg-danger-100 text-danger-700",
  restore: "bg-brass-100 text-brass-700",
};

function actionBadgeClass(action: string) {
  const verb = action.split(".")[1]?.replace(/^bulk_/, "") ?? "";
  return ACTION_COLOR[verb] ?? "";
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page],
    queryFn: () => auditApi.listAuditLogs(page, pageSize),
    enabled: isOwner,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  if (currentAdmin && !isOwner) {
    return (
      <div>
        <PageHeader title="Audit Log" />
        <SettingsSubNav />
        <p className="text-sm text-ink-500">Only store owners can review the audit log.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Audit Log" />
      <SettingsSubNav />
      <p className="-mt-3 mb-4 text-sm text-ink-500">
        Every create, update, delete, restore, and bulk action taken in this admin panel, with who did it and when.
      </p>

      <div className="overflow-hidden rounded-lg border border-ink-100 bg-cream-50">
        <HScrollShadow className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Admin</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={8} cols={5} />}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-400">
                  No activity recorded yet.
                </td>
              </tr>
            )}
            {data?.items.map((entry) => (
              <tr key={entry.id} className="border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                <td className="whitespace-nowrap px-4 py-3 text-ink-500">{new Date(entry.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-ink-700">{entry.admin?.name ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge className={actionBadgeClass(entry.action)}>{entry.action}</Badge>
                </td>
                <td className="px-4 py-3 text-ink-500">
                  {entry.entityType}
                  {entry.entityId && <span className="text-ink-300"> · {entry.entityId.slice(0, 10)}…</span>}
                </td>
                <td className="px-4 py-3 text-ink-400">{entry.ipAddress ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </HScrollShadow>
      </div>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
