import Link from "next/link";
import { Table } from "@/components/ui/table";
import type { SlowMovingProduct } from "@/lib/api/admin-analytics";
import { productEditHref } from "@/lib/admin-routes";

export function SlowMovingTable({ products }: { products: SlowMovingProduct[] }) {
  if (products.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">Nothing slow-moving right now.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <thead className="ui-card-table-head">
          <tr>
            <th className="pb-2 pr-3">Product</th>
            <th className="pb-2 pr-3 text-right">Units sold (30d)</th>
            <th className="pb-2 text-right">Stock on hand</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className="border-t border-ink-100">
              <td className="py-2 pr-3">
                <Link href={productEditHref(p.id)} className="text-ink-800 hover:text-brass-600">
                  {p.name}
                </Link>
              </td>
              <td className="py-2 pr-3 text-right text-ink-600">{p.unitsSold}</td>
              <td className="py-2 text-right text-ink-500">{p.totalStock}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
