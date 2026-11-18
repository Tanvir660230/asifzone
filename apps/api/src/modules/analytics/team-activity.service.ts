import { prisma } from "../../config/prisma";
import { resolveLegacyWindow, utcInstant } from "../../domain/metrics/store-time";

/**
 * Team activity (docs/superpowers/plans/2026-11-18-business-reports.md, Part 3): who moved which orders in a period,
 * read from the order status history — confirmed, cancelled, packed, shipped, delivered and returned marks per admin,
 * and the median time from an order coming in to the admin confirming it. Moves with no admin behind them (courier
 * updates, automations) are counted apart. These are counts of work, not money: no business metric is computed here.
 */
export interface TeamMember {
  adminId: string;
  name: string;
  confirmed: number;
  cancelled: number;
  packed: number;
  shipped: number;
  delivered: number;
  returned: number;
  total: number;
  /** Orders this admin confirmed: median minutes from the order coming in to the confirmation (null when none). */
  medianMinutesToConfirm: number | null;
}

export interface TeamActivity {
  range: { from: string; to: string };
  people: TeamMember[];
  automatic: Omit<TeamMember, "adminId" | "name" | "medianMinutesToConfirm">;
}

const COUNTED = ["CONFIRMED", "CANCELLED", "PACKED", "SHIPPED", "DELIVERED", "RETURNED"] as const;
type Counted = (typeof COUNTED)[number];
const FIELD: Record<Counted, keyof Omit<TeamMember, "adminId" | "name" | "total" | "medianMinutesToConfirm">> = {
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  PACKED: "packed",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  RETURNED: "returned",
};

const empty = () => ({ confirmed: 0, cancelled: 0, packed: 0, shipped: 0, delivered: 0, returned: 0, total: 0 });

export async function getTeamActivity(days?: number, dateFrom?: Date, dateTo?: Date): Promise<TeamActivity> {
  const range = await resolveLegacyWindow(days ?? 30, dateFrom, dateTo);
  const [counts, confirmTimes] = await Promise.all([
    prisma.$queryRaw<Array<{ adminId: string | null; name: string | null; status: Counted; n: bigint }>>`
      SELECT h."changedByAdminId" AS "adminId", a.name, h.status::text AS status, COUNT(*)::bigint AS n
      FROM "OrderStatusHistory" h LEFT JOIN "AdminUser" a ON a.id = h."changedByAdminId"
      WHERE h."createdAt" >= ${utcInstant(range.startUtc)} AND h."createdAt" < ${utcInstant(range.endUtc)}
        AND h.status::text IN ('CONFIRMED', 'CANCELLED', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED')
      GROUP BY 1, 2, 3`,
    prisma.$queryRaw<Array<{ adminId: string; minutes: number }>>`
      SELECT h."changedByAdminId" AS "adminId",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (h."createdAt" - o."createdAt")) / 60)::float AS minutes
      FROM "OrderStatusHistory" h JOIN "Order" o ON o.id = h."orderId"
      WHERE h.status = 'CONFIRMED' AND h."changedByAdminId" IS NOT NULL
        AND h."createdAt" >= ${utcInstant(range.startUtc)} AND h."createdAt" < ${utcInstant(range.endUtc)}
      GROUP BY 1`,
  ]);

  const people = new Map<string, TeamMember>();
  const automatic = empty();
  for (const row of counts) {
    const n = Number(row.n);
    const field = FIELD[row.status];
    if (!row.adminId) {
      automatic[field] += n;
      automatic.total += n;
      continue;
    }
    const p = people.get(row.adminId) ?? { adminId: row.adminId, name: row.name ?? "Former admin", ...empty(), medianMinutesToConfirm: null };
    p[field] += n;
    p.total += n;
    people.set(row.adminId, p);
  }
  for (const t of confirmTimes) {
    const p = people.get(t.adminId);
    if (p) p.medianMinutesToConfirm = Math.round(t.minutes);
  }

  return {
    range: { from: range.from, to: range.to },
    people: [...people.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    automatic,
  };
}
