import type { CohortRetention } from "@/lib/api/admin-analytics";

const MAX_OFFSET = 5;

function formatCohortMonth(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Cohort-retention grid: rows are acquisition months, columns are "M0..M5" months since first
 * order, cells are the % of that cohort who ordered again — same sequential-ink cell fill as
 * TrafficHeatmap. Cells past the cohort's elapsed lifetime (offset > months since acquisition)
 * render as a dash instead of 0%, since "not yet elapsed" and "zero retention" are different facts. */
export function CohortRetentionGrid({ cohorts }: { cohorts: CohortRetention[] }) {
  if (cohorts.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">Not enough repeat-customer data yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-ink-500">
            <th className="pb-2 pr-4">Cohort</th>
            <th className="pb-2 pr-4 text-right">Size</th>
            {Array.from({ length: MAX_OFFSET + 1 }, (_, i) => (
              <th key={i} className="pb-2 text-center">
                M{i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => (
            <tr key={cohort.cohortMonth} className="border-t border-ink-100">
              <td className="py-2 pr-4 text-ink-800">{formatCohortMonth(cohort.cohortMonth)}</td>
              <td className="py-2 pr-4 text-right text-ink-500">{cohort.cohortSize}</td>
              {Array.from({ length: MAX_OFFSET + 1 }, (_, offset) => {
                const point = cohort.retention.find((r) => r.monthOffset === offset);
                if (!point) {
                  return (
                    <td key={offset} className="py-1 text-center text-ink-300">
                      —
                    </td>
                  );
                }
                const alpha = 0.08 + (point.retentionPct / 100) * 0.77;
                return (
                  <td key={offset} className="py-1 text-center">
                    <span
                      title={`${point.activeCustomers} of ${cohort.cohortSize} customers ordered again`}
                      className="inline-flex h-8 w-14 items-center justify-center rounded-sm text-xs font-medium"
                      style={{ backgroundColor: `rgba(17,17,17,${alpha})`, color: alpha > 0.45 ? "#fff" : "#1a1a1a" }}
                    >
                      {point.retentionPct.toFixed(0)}%
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
