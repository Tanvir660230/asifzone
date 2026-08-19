/** Shared between label-pdf.ts's capture-loop callback and the print-labels page's UI state, so the
 * two can't drift apart on shape. */
export interface CaptureProgress {
  done: number;
  total: number;
}
