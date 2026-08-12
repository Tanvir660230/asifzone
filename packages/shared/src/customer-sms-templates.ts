/** {{variable}} vocabulary for customer-level marketing SMS (individual + bulk send, SmsTemplate
 * rows) — deliberately a different syntax/vocabulary from sms-templates.ts's {placeholder} order-
 * touchpoint templates, since those are order-level (order number/total) and these are
 * customer-level (name/lifetime spend/last order). {{coupon}}/{{discount}}/{{tracking}} aren't
 * offered yet — there's no per-customer coupon-attach flow to resolve them against. */
export interface CustomerSmsVars {
  customerName: string;
  firstName: string;
  phone: string;
  totalSpent: string;
  lastOrder: string;
  website: string;
}

export const CUSTOMER_SMS_VARIABLES: Array<{ token: string; label: string }> = [
  { token: "{{customer_name}}", label: "Full name" },
  { token: "{{first_name}}", label: "First name" },
  { token: "{{phone}}", label: "Phone" },
  { token: "{{total_spent}}", label: "Total spent" },
  { token: "{{last_order}}", label: "Last order date" },
  { token: "{{website}}", label: "Website" },
];

export function renderCustomerSmsTemplate(body: string, vars: CustomerSmsVars): string {
  return body
    .replaceAll("{{customer_name}}", vars.customerName)
    .replaceAll("{{first_name}}", vars.firstName)
    .replaceAll("{{phone}}", vars.phone)
    .replaceAll("{{total_spent}}", vars.totalSpent)
    .replaceAll("{{last_order}}", vars.lastOrder)
    .replaceAll("{{website}}", vars.website);
}

/** Seeded into the SmsTemplate table the first time it's read empty (see sms-template.service.ts)
 * — a starting set an admin can edit or delete, not a fixed/protected list. */
export const DEFAULT_MARKETING_SMS_TEMPLATES: Array<{ name: string; body: string }> = [
  {
    name: "Welcome",
    body: "Assalamu Alaikum {{first_name}}! Thanks for joining us. Explore our latest collection at {{website}}. We're glad to have you with us ❤️",
  },
  {
    name: "Eid Offer",
    body: "Assalamu Alaikum {{customer_name}}, Our Eid Collection is now live! Enjoy special prices for a limited time. Visit {{website}} — Thank you ❤️",
  },
  {
    name: "Flash Sale",
    body: "{{first_name}}, a Flash Sale just started — up to 50% off for a few hours only! Shop now at {{website}} before it ends.",
  },
  {
    name: "Delivery Update",
    body: "Hi {{customer_name}}, your order is on its way and should arrive soon. Thank you for shopping with us!",
  },
  {
    name: "Coupon Offer",
    body: "{{first_name}}, here's a little something for you — enjoy a special discount on your next order at {{website}}. Thank you for being a valued customer.",
  },
  {
    name: "Thank You",
    body: "Thank you {{customer_name}} for your order! We truly appreciate your trust in us. See you again soon at {{website}} ❤️",
  },
];
