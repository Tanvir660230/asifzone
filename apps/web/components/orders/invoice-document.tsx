import type { Order, StoreSettings } from "@clothing-brand/shared";
import { formatPrice } from "@/lib/format";

interface InvoiceDocumentProps {
  order: Order;
  store: StoreSettings | undefined;
}

/** The printable invoice paper itself — shared by the admin order invoice page and the
 * customer-facing account invoice page, which differ only in the surrounding back/print chrome. */
export function InvoiceDocument({ order, store }: InvoiceDocumentProps) {
  return (
    <div className="border border-ink-200 p-8">
      <div className="mb-8 flex items-start justify-between border-b border-ink-100 pb-6 print:break-inside-avoid">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{store?.storeName ?? "Store"}</h1>
          {store?.contactEmail && <p className="text-sm text-ink-500">{store.contactEmail}</p>}
          {store?.contactPhone && <p className="text-sm text-ink-500">{store.contactPhone}</p>}
        </div>
        <div className="text-right">
          <h2 className="font-display text-xl text-ink-900">Invoice</h2>
          <p className="text-sm text-ink-500">{order.orderNumber}</p>
          <p className="text-sm text-ink-500">{new Date(order.createdAt).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-6 text-sm">
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-ink-400">Bill To</p>
          <p className="font-medium text-ink-900">{order.customerName}</p>
          <p className="text-ink-600">{order.customerPhone}</p>
          {order.customerEmail && <p className="text-ink-600">{order.customerEmail}</p>}
        </div>
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-ink-400">Ship To</p>
          <p className="text-ink-600">{order.shippingAddressLine}</p>
          <p className="text-ink-600">
            {order.shippingArea}, {order.shippingDistrict}, {order.shippingDivision}
          </p>
        </div>
      </div>

      <div className="mb-6 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="pb-2">Item</th>
              <th className="pb-2">SKU</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="pb-2 text-right">Price</th>
              <th className="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              // print:break-inside-avoid — a long order's item table shouldn't split a single row
              // across a page break; the global @page A4 sizing (see globals.css, shared with the
              // shipping-label sheet) already handles page geometry, so this is the one print
              // concern left specific to a variable-length table.
              <tr key={item.id} className="border-b border-ink-50 print:break-inside-avoid">
                <td className="py-2">
                  {item.productNameSnapshot} ({item.sizeSnapshot}/{item.colorSnapshot})
                </td>
                <td className="py-2 text-ink-500">{item.skuSnapshot}</td>
                <td className="py-2 text-right">{item.quantity}</td>
                <td className="py-2 text-right">{formatPrice(item.priceSnapshot)}</td>
                <td className="py-2 text-right">{formatPrice(Number(item.priceSnapshot) * item.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto max-w-xs space-y-1 text-sm print:break-inside-avoid">
        <div className="flex justify-between text-ink-600">
          <span>Subtotal</span>
          <span>{formatPrice(order.subtotal)}</span>
        </div>
        {Number(order.discount) > 0 && (
          <div className="flex justify-between text-ink-600">
            <span>Discount</span>
            <span>−{formatPrice(order.discount)}</span>
          </div>
        )}
        <div className="flex justify-between text-ink-600">
          <span>Shipping</span>
          <span>{formatPrice(order.shippingFee)}</span>
        </div>
        <div className="flex justify-between border-t border-ink-200 pt-1.5 text-base font-medium text-ink-900">
          <span>Total</span>
          <span>{formatPrice(order.total)}</span>
        </div>
      </div>

      <p className="mt-8 border-t border-ink-100 pt-4 text-xs text-ink-400">
        Payment method: {order.paymentMethod === "COD" ? "Cash on Delivery" : "Paid online"} · Payment status: {order.paymentStatus}
      </p>
    </div>
  );
}
