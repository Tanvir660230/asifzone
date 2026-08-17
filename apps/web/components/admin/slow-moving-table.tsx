import Link from "next/link";
import type { SlowMovingProduct } from "@/lib/api/admin-analytics";

export function SlowMovingTable({ products }: { products: SlowMovingProduct[] }) {
  if (products.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">Nothing slow-moving right now.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
        <tr>
          <th className="pb-2">Product</th>
          <th className="pb-2 text-right">Units sold (30d)</th>
          <th className="pb-2 text-right">Stock on hand</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => (
          <tr key={p.id} className="border-t border-ink-100">
            <td className="py-2">
              <Link href={`/admin/products/${p.id}/edit`} className="text-ink-800 hover:text-brass-600">
                {p.name}
              </Link>
            </td>
            <td className="py-2 text-right text-ink-600">{p.unitsSold}</td>
            <td className="py-2 text-right text-ink-500">{p.totalStock}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
