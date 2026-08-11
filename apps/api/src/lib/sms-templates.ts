interface AdminOrderAlertContext {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  total: number;
}

export function newOrderAdminAlertSms({ orderNumber, customerName, customerPhone, total }: AdminOrderAlertContext): string {
  return `নতুন অর্ডার #${orderNumber} — ${customerName}, ${customerPhone}। মোট: ৳${total}। ড্যাশবোর্ড চেক করুন।`;
}
