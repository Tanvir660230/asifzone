/**
 * Why an order was cancelled before it was sent. Staff wrote reasons by hand, mostly in Banglish ("nibe na", "phone
 * dhore na"), so a report could only list raw notes. These are the reasons that cover what staff actually write; the
 * cancel dialog's chips write a known phrase, and `classifyCancelNote` reads both the phrases and the free text back.
 * A parcel refused at the door after it was sent is not here — that is a delivery outcome (Deliveries report).
 */
export const CANCEL_REASONS = ["no_answer", "declined", "wrong_number", "duplicate", "fake", "price", "other", "unspecified"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  no_answer: "Couldn't reach them",
  declined: "Customer said no",
  wrong_number: "Wrong number",
  duplicate: "Duplicate order",
  fake: "Fake or prank order",
  price: "Price or delivery charge",
  other: "Other",
  unspecified: "No reason written",
};

/** The reasons offered as chips when cancelling (Other is the free-text field; "unspecified" is never chosen). */
export const CANCEL_REASON_CHOICES = ["no_answer", "declined", "wrong_number", "duplicate", "fake", "price"] as const satisfies readonly CancelReason[];

const CHIP_NOTE: Record<(typeof CANCEL_REASON_CHOICES)[number], string> = {
  no_answer: "No answer",
  declined: "Customer declined",
  wrong_number: "Wrong number",
  duplicate: "Duplicate order",
  fake: "Fake order",
  price: "Price or delivery charge too high",
};

/** The note a reason chip writes (staff may add to it). */
export function cancelReasonNote(reason: CancelReason): string {
  return reason in CHIP_NOTE ? CHIP_NOTE[reason as keyof typeof CHIP_NOTE] : CANCEL_REASON_LABELS[reason];
}

/** Checked in order — the first match wins ("phone off, nibe na" is someone who did answer later and said no). */
const RULES: Array<[CancelReason, RegExp]> = [
  ["declined", /\b(nibe ?na|nibena|lagbe ?na|lagbena|chai ?na|chaina|declin|changed (his|her|their)? ?mind|don'?t want|cancelled by the customer)/i],
  ["wrong_number", /\b(wrong|vul|bhul|vhul) ?(number|nombor|no\.?)\b/i],
  ["duplicate", /\b(duplicate|double|same order|already ordered|2 bar order|abar order)/i],
  ["fake", /\b(fake|fraud|prank|spam|bhuya|vuya|bhua)\b/i],
  ["price", /\b(price|dam|daam|expensive|beshi dam|charge)\b/i],
  ["no_answer", /\b(no answer|not answer|unanswered|phone off|switched off|switch off|busy|dhore ?na|dhorena|dhorche ?na|recive kore ?na|receive kore ?na|call (dhore|recive|receive)|bondho|off)\b/i],
];

/** The reason behind a cancellation note — chip phrases and staff's own words alike. */
export function classifyCancelNote(note: string | null | undefined): CancelReason {
  const text = (note ?? "").trim();
  if (!text || /^(cancel+ed|cancel|cancelled by staff|order cancel+ed)\.?$/i.test(text)) return "unspecified";
  for (const [reason, re] of RULES) if (re.test(text)) return reason;
  return "other";
}
