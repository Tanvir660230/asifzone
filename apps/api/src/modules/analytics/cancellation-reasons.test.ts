import { describe, expect, it } from "vitest";
import { CANCEL_REASONS, CANCEL_REASON_LABELS, cancelReasonNote, classifyCancelNote } from "@clothing-brand/shared";

// Staff write cancellation reasons by hand, mostly in Banglish — these are the kinds of notes stores actually see
// (a bare phone number, "nibe na", "phone dhore na"…). The report groups them; new cancellations pick a reason chip.

describe("classifyCancelNote", () => {
  const cases: Array<[string | null, string]> = [
    ["nibe na", "declined"],
    ["Nibe na", "declined"],
    ["nibena", "declined"],
    ["lagbe na ar", "declined"],
    ["Declined on call: customer changed mind", "declined"],
    ["Cancelled by the customer from the SMS link", "declined"],
    ["phone dhore na", "no_answer"],
    ["Phone off", "no_answer"],
    ["phone off", "no_answer"],
    ["Confirmation call: No answer (3 of 3 unanswered)", "no_answer"],
    ["call dhorena 3 bar", "no_answer"],
    ["wrong number", "wrong_number"],
    ["vul number", "wrong_number"],
    ["duplicate order", "duplicate"],
    ["same order 2 bar", "duplicate"],
    ["fake order", "fake"],
    ["dam beshi", "price"],
    ["delivery charge beshi bolse", "price"],
    ["Cancelled", "unspecified"],
    ["cancel", "unspecified"],
    ["", "unspecified"],
    [null, "unspecified"],
    ["01700000000", "other"],
    ["adjust", "other"],
  ];
  it.each(cases)("%s → %s", (note, reason) => {
    expect(classifyCancelNote(note)).toBe(reason);
  });

  it("every reason a chip writes is read back as that same reason", () => {
    for (const r of CANCEL_REASONS) {
      if (r === "unspecified") continue;
      expect(classifyCancelNote(cancelReasonNote(r))).toBe(r);
      expect(classifyCancelNote(`${cancelReasonNote(r)}: called twice`)).toBe(r);
    }
  });

  it("has a label for every reason", () => {
    for (const r of CANCEL_REASONS) expect(CANCEL_REASON_LABELS[r]).toBeTruthy();
  });
});
