import { LABEL_TEMPLATES, type LabelTemplateId } from "./label-templates";

const STORAGE_KEY = "admin:print-labels:last-options";

export interface StoredPrintPrefs {
  templateId: LabelTemplateId;
  orientation: "portrait" | "landscape";
  marginMm: number;
  copies: number;
}

function isLabelTemplateId(value: unknown): value is LabelTemplateId {
  return typeof value === "string" && LABEL_TEMPLATES.some((t) => t.id === value);
}

/** Reads back whichever template/orientation/margin/copies the admin last printed with, so the
 * print-labels page opens pre-set to their usual sticker size instead of always resetting to the
 * a4-6up default — a shop running one physical label size on their thermal printer otherwise has to
 * re-pick that size (and re-widen the margin, re-set copies…) on every single visit to this page.
 *
 * Validated field-by-field rather than trusting the parsed JSON wholesale: localStorage can hold a
 * templateId that's since been removed from LABEL_TEMPLATES, a hand-edited/corrupted value, or data
 * from an older shape of this record. Any individual field that doesn't check out is simply omitted
 * (falls back to the caller's own default for that one field) rather than discarding the whole
 * stored record over one bad field. */
export function loadStoredPrintPrefs(): Partial<StoredPrintPrefs> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const prefs: Partial<StoredPrintPrefs> = {};

    if (isLabelTemplateId(parsed.templateId)) prefs.templateId = parsed.templateId;
    if (parsed.orientation === "portrait" || parsed.orientation === "landscape") {
      prefs.orientation = parsed.orientation;
    }
    if (typeof parsed.marginMm === "number" && Number.isFinite(parsed.marginMm) && parsed.marginMm >= 0 && parsed.marginMm <= 20) {
      prefs.marginMm = parsed.marginMm;
    }
    if (typeof parsed.copies === "number" && Number.isInteger(parsed.copies) && parsed.copies >= 1 && parsed.copies <= 20) {
      prefs.copies = parsed.copies;
    }

    return prefs;
  } catch {
    return {};
  }
}

/** Persists the admin's current print options so the next visit to this page can restore them via
 * loadStoredPrintPrefs. Best-effort and silent: a full or disabled localStorage (private browsing,
 * quota, some locked-down admin browser) just means the preference doesn't stick this time — never
 * worth surfacing as an error over what's otherwise a successful print job. */
export function saveStoredPrintPrefs(prefs: StoredPrintPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore — see doc comment above.
  }
}
