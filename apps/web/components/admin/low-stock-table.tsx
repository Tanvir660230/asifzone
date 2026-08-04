import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { LowStockVariant } from "@/lib/api/admin-analytics";

export function LowStockTable({ variants }: { variants: LowStockVariant[] }) {
  if (variants.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">Nothing running low right now.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
        <tr>
          <th className="pb-2">Product</th>
          <th className="pb-2">Variant</th>
          <th className="pb-2 text-right">Stock</th>
        </tr>
      </thead>
      <tbody>
        {variants.map((v) => (
          <tr key={v.id} className="border-t border-ink-100">
            <td className="py-2">
              <Link href={`/admin/products`} className="text-ink-800 hover:text-brass-600">
                {v.product.name}
              </Link>
            </td>
            <td className="py-2 text-ink-500">
              {v.size} / {v.color} · {v.sku}
            </td>
            <td className="py-2 text-right">
              <span className={`inline-flex items-center gap-1 ${v.stock === 0 ? "text-danger-600" : "text-warning-600"}`}>
                {v.stock === 0 && <AlertTriangle size={12} />}
                {v.stock}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
