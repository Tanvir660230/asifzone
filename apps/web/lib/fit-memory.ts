/** "Find my size" answers, kept in this browser so every product with a size finder can pick the shopper's size for them.
 * Nothing is sent anywhere. Storage may be blocked (private mode): then the finder just starts empty. */

export interface FitAnswers {
  heightIn: number;
  weightKg: number;
  chestIn?: number | null;
  usualSize?: string | null;
  overLayer?: boolean;
}

const KEY = "az_fit_answers_v1";

export function readFitAnswers(): FitAnswers | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const a = raw as Record<string, unknown>;
    if (typeof a.heightIn !== "number" || typeof a.weightKg !== "number") return null;
    return {
      heightIn: a.heightIn,
      weightKg: a.weightKg,
      chestIn: typeof a.chestIn === "number" ? a.chestIn : null,
      usualSize: typeof a.usualSize === "string" ? a.usualSize : null,
      overLayer: a.overLayer === true,
    };
  } catch {
    return null;
  }
}

export function saveFitAnswers(answers: FitAnswers): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(answers));
  } catch {
    // Storage blocked: the answer still applies to this page.
  }
}
