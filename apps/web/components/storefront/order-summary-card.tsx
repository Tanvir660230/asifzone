import type { Order } from "@clothing-brand/shared";
import { formatPrice } from "@/lib/format";

const STATUS_LABELS: Record<Order["status"], string> = {
  PENDING: "Pending confirmation",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export function OrderSummaryCard({ order }: { order: Order }) {
  return (
    <div className="border border-ink-100 p-6 text-left">
      <div className="mb-4 flex items-center justify-between border-b border-ink-100 pb-4">
        <span className="text-sm text-ink-500">Status</span>
        <span className="text-sm font-medium text-ink-900">{STATUS_LABELS[order.status]}</span>
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
