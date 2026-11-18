import type { ScorecardFigure } from "./scorecard.service";

/**
 * The weekly and monthly report as one text (docs/superpowers/plans/2026-11-18-business-reports.md, Part 4). Plain ASCII
 * like the morning brief (anomalies.service): a ৳ or a Bangla letter turns it into a Unicode SMS of 70 characters a
 * part. The weekly text is the month so far against its targets; the monthly one closes the month just ended.
 */
export const PERIOD_SMS_MAX = 306; // two concatenated GSM parts

const whole = (n: number) => Math.round(n).toLocaleString("en-US");

export function composePeriodReport(input: { storeName: string; currency: string; kind: "week" | "month"; periodLabel: string; figures: ScorecardFigure[] }): string {
  const { currency, kind, figures } = input;
  const by = new Map(figures.map((x) => [x.key, x]));
  const money = (n: number) => `${currency} ${whole(n)}`;
  const parts: string[] = [];

  const sales = by.get("netSales");
  if (sales?.value != null) {
    let s = `Sales ${money(sales.value)}`;
    if (sales.target != null) {
      s += ` of ${whole(sales.target)}`;
      if (sales.status === "bad") s += kind === "month" ? " (missed)" : " (behind)";
    }
    parts.push(s);
  }
  const orders = by.get("orders");
  if (orders?.value != null) parts.push(`Orders ${whole(orders.value)}${orders.target != null ? ` of ${whole(orders.target)}` : ""}`);
  const delivered = by.get("deliverySuccess");
  if (delivered?.value != null) parts.push(`Delivered ${(delivered.value * 100).toFixed(1)}%`);
  const returns = by.get("returnRate");
  if (returns?.value != null) parts.push(`Returns ${(returns.value * 100).toFixed(1)}%`);
  const profit = by.get("profit");
  if (profit?.value != null) parts.push(profit.value < 0 ? `Loss ${money(-profit.value)}` : `Profit ${money(profit.value)}`);
  const ads = by.get("adSpend");
  const roas = by.get("salesPerAdTaka");
  if (ads?.value != null && ads.value > 0) parts.push(`Ads ${money(ads.value)}${roas?.value != null ? ` (${roas.value.toFixed(1)}x sales)` : ""}`);

  const body = `${input.periodLabel}: ${parts.join(", ")}`;
  const room = PERIOD_SMS_MAX - body.length - 3;
  const name = input.storeName.length > room ? input.storeName.slice(0, Math.max(0, room)) : input.storeName;
  return `${name} - ${body}`.slice(0, PERIOD_SMS_MAX);
}
