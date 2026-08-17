import type { Order } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { formatPrice, orderStatusBadgeClass, orderStatusLabel } from "@/lib/format";

export function OrderSummaryCard({ order }: { order: Order }) {
  return (
    <div className="rounded-lg border border-ink-100 bg-cream-50 p-6 text-left shadow-sm transition-shadow duration-150 ease-smooth hover:shadow-float">
      <div className="mb-4 flex items-center justify-between border-b border-ink-100 pb-4">
        <span className="text-sm text-ink-500">Status</span>
        <Badge className={orderStatusBadgeClass(order.status)}>{orderStatusLabel(order.status)}</Badge>
      </div>

      <div className="space-y-2 text-sm">
        {order.items.map((item) => (
          <div key={item.id} className="flex justify-between text-ink-600">
            <span>
              {item.productNameSnapshot} ({item.sizeSnapshot}/{item.colorSnapshot}) × {item.quantity}
            </span>
            <span>{formatPrice(Number(item.priceSnapshot) * item.quantity)}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-1 border-t border-ink-100 pt-4 text-sm">
        <div className="flex justify-between text-ink-600">
          <span>Subtotal</span>
          <span>{formatPrice(order.subtotal)}</span>
        </div>
        {Number(order.discount) > 0 && (
          <div className="flex justify-between text-success-600">
            <span>Discount</span>
            <span>−{formatPrice(order.discount)}</span>
          </div>
        )}
        <div className="flex justify-between text-ink-600">
          <span>Shipping</span>
          <span>{formatPrice(order.shippingFee)}</span>
        </div>
        <div className="flex justify-between border-t border-ink-100 pt-1 text-base text-ink-900">
          <span>Total</span>
          <span>{formatPrice(order.total)}</span>
        </div>
      </div>

      <p className="mt-4 text-xs text-ink-400">
        Payment: {order.paymentMethod === "COD" ? "Cash on Delivery" : "Paid online"} · Shipping to {order.shippingArea},{" "}
        {order.shippingDistrict}, {order.shippingDivision}
      </p>
    </div>
  );
}
