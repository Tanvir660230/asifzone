"use client";

import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import * as analyticsApi from "@/lib/api/admin-analytics";

function minutes(m: number | null) {
  if (m === null) return "—";
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} days`;
}

/**
 * Team activity (docs/superpowers/plans/2026-11-18-business-reports.md, Part 3): who confirmed, cancelled, packed and
 * shipped how many orders in the period, and how long after an order came in each admin confirmed it. Courier updates
 * and automations are the last row. Owner only.
 */
export function TeamActivityCard({ days }: { days?: number }) {
  const q = useQuery({ queryKey: ["bi-team-activity", days], queryFn: () => analyticsApi.getTeamActivity(days), staleTime: 60_000 });
  const cols = ["confirmed", "cancelled", "packed", "shipped", "delivered", "returned"] as const;
  const LABEL: Record<(typeof cols)[number], string> = { confirmed: "Confirmed", cancelled: "Cancelled", packed: "Packed", shipped: "Shipped", delivered: "Delivered", returned: "Returned" };

  return (
    <Card data-testid="team-activity">
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <p className="text-sm text-fg-muted">Orders each person moved in this period, and how soon after an order came in they confirmed it.</p>
      </CardHeader>
      <CardContent>
        {q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : q.data.people.length === 0 && q.data.automatic.total === 0 ? (
          <EmptyState icon={Users} title="No order moves in this period" />
        ) : (
          <TableContainer>
            <Table aria-label="Team activity">
              <TableHead>
                <tr>
                  <TableHeaderCell>Person</TableHeaderCell>
                  {cols.map((c) => (
                    <TableHeaderCell key={c} align="right">
                      {LABEL[c]}
                    </TableHeaderCell>
                  ))}
                  <TableHeaderCell align="right">Time to confirm</TableHeaderCell>
                </tr>
              </TableHead>
              <tbody>
                {q.data.people.map((p) => (
                  <TableRow key={p.adminId}>
                    <TableCell className="font-medium text-fg">{p.name}</TableCell>
                    {cols.map((c) => (
                      <TableCell key={c} align="right">
                        {p[c] || "—"}
                      </TableCell>
                    ))}
                    <TableCell align="right">{minutes(p.medianMinutesToConfirm)}</TableCell>
                  </TableRow>
                ))}
                {q.data.automatic.total > 0 && (
                  <TableRow>
                    <TableCell className="text-fg-muted">Courier updates &amp; automatic</TableCell>
                    {cols.map((c) => (
                      <TableCell key={c} align="right" className="text-fg-muted">
                        {q.data.automatic[c] || "—"}
                      </TableCell>
                    ))}
                    <TableCell align="right" className="text-fg-muted">
                      —
                    </TableCell>
                  </TableRow>
                )}
              </tbody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
