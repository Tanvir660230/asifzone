export type CustomerSmsTouchpoint = "PLACED" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED";

/** Single source of truth for both the default Bengali copy actually sent (apps/api/src/lib/order-sms.ts)
 * and the placeholder text shown in the admin's editable template box (apps/web sms-notifications page)
 * — kept here, not duplicated in each app, so the two can never silently drift apart. */
export const DEFAULT_CUSTOMER_SMS_TEMPLATES: Record<CustomerSmsTouchpoint, string> = {
  PLACED: "{storeName}: ধন্যবাদ {customerName}! আপনার অর্ডার #{orderNumber} সফলভাবে গ্রহণ করা হয়েছে। মোট: ৳{total}। আমরা শীঘ্রই যোগাযোগ করব।",
  CONFIRMED: "{storeName}: সুখবর! আপনার অর্ডার #{orderNumber} নিশ্চিত করা হয়েছে এবং প্রস্তুত করা হচ্ছে।",
  SHIPPED: "{storeName}: আপনার অর্ডার #{orderNumber} পাঠানো হয়েছে। আশা করছি শীঘ্রই আপনার হাতে পৌঁছে যাবে।",
  DELIVERED: "{storeName}: আপনার অর্ডার #{orderNumber} সফলভাবে ডেলিভারি সম্পন্ন হয়েছে। আমাদের সাথে কেনাকাটার জন্য ধন্যবাদ!",
  CANCELLED: "{storeName}: দুঃখিত, আপনার অর্ডার #{orderNumber} বাতিল করা হয়েছে। কোনো প্রশ্ন থাকলে আমাদের সাথে যোগাযোগ করুন।",
};

export interface OrderSmsVars {
  orderNumber: string;
  total: number;
  storeName: string;
  customerName: string;
}

/** `{placeholder}` substitution, not a full template engine — the vocabulary is fixed (order
 * number/total/store/customer name) and admins edit this text in a plain textarea, so anything
 * fancier (conditionals, loops) would be unusable there anyway. */
export function renderOrderSms(template: string, vars: OrderSmsVars): string {
  return template
    .replaceAll("{customerName}", vars.customerName)
    .replaceAll("{orderNumber}", vars.orderNumber)
    .replaceAll("{total}", String(vars.total))
    .replaceAll("{storeName}", vars.storeName);
}
