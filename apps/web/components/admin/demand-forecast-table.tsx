import { AlertTriangle } from "lucide-react";
import type { DemandForecastVariant } from "@/lib/api/admin-analytics";

export function DemandForecastTable({ variants }: { variants: DemandForecastVariant[] }) {
  if (variants.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">No variants are selling fast enough to project a stockout yet.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
        <tr>
          <th className="pb-2">Product</th>
          <th className="pb-2 text-right">Stock</th>
          <th className="pb-2 text-right">Daily velocity</th>
          <th className="pb-2 text-right">Stockout in</th>
        </tr>
      </thead>
      <tbody>
        {variants.map((v) => (
          <tr key={v.variantId} className="border-t border-ink-100">
            <td className="py-2">
              <p className="text-ink-800">{v.productName}</p>
              <p className="text-xs text-ink-400">{v.sku}</p>
            </td>
            <td className="py-2 text-right text-ink-600">{v.stock}</td>
            <td className="py-2 text-right text-ink-500">{v.dailyVelocity.toFixed(1)}/day</td>
            <td className="py-2 text-right">
              <span className={`inline-flex items-center gap-1 ${v.daysUntilStockout <= 7 ? "text-danger-600" : "text-warning-600"}`}>
                {v.daysUntilStockout <= 7 && <AlertTriangle size={12} />}
                {Math.round(v.daysUntilStockout)}d
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
