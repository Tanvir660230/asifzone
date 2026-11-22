import { describe, expect, it } from "vitest";
import { codChangeOf } from "./cod-fact";

/** Bodies as Steadfast sent them in November 2026 (identifiers changed). */
const merchantEdit = {
  values: { cod_amount: 120 }, changed: ["cod_amount"], invoice: "ORD-20261121-AAAAAA", event_id: "c63e556d-0000-4c80-bfa3-064a58927338",
  updated_at: "2026-11-22 12:48:40", business_id: null, tracking_id: "SFR261121ST00000BBD", consignment_id: 323744573, notification_type: "consignment_update",
};
const tracking = (m: string) => ({ notification_type: "tracking_update", consignment_id: 323744573, invoice: "ORD-20261121-AAAAAA", tracking_message: m, updated_at: "2026-11-21 13:17:00" });

describe("codChangeOf — a changed cash-on-delivery amount in a Steadfast push", () => {
  it("reads the merchant panel's change", () => {
    expect(codChangeOf(merchantEdit)).toEqual({ from: null, to: 120, source: "MERCHANT", at: "2026-11-22 12:48:40" });
  });

  it("reads a change made together with the note", () => {
    expect(codChangeOf({ ...merchantEdit, changed: ["note", "cod_amount"], values: { note: "-partial hobe", cod_amount: 1000 } })).toMatchObject({ to: 1000 });
  });

  it("reads the hub's or the rider's change, whatever the spacing", () => {
    expect(codChangeOf(tracking('Amount has been changed  from "1510" to "120"'))).toEqual({ from: 1510, to: 120, source: "COURIER", at: "2026-11-21 13:17:00" });
    expect(codChangeOf(tracking('Amount has been changed from "999.00" to "0"'))).toMatchObject({ from: 999, to: 0 });
  });

  it("reads the panel's change when it comes as tracking text", () => {
    expect(codChangeOf(tracking("Changes: COD '1510' to '1200'. By User Tanvir Khan(2506499)"))).toEqual({ from: 1510, to: 1200, source: "MERCHANT", at: "2026-11-21 13:17:00" });
    expect(codChangeOf(tracking("Changes: Address 'a' to 'b'.COD '1500' to '1450'. By User X(1)"))).toMatchObject({ from: 1500, to: 1450 });
    expect(codChangeOf(tracking("Changes: COD &#039;1510&#039; to &#039;120&#039;. By User X(1)"))).toMatchObject({ to: 120 });
  });

  it("is null for anything that changes no amount", () => {
    expect(codChangeOf({ ...merchantEdit, changed: ["note"], values: { note: "cod 120" } })).toBeNull();
    expect(codChangeOf(tracking('Rider Note: "Cod 120 tk hbe"'))).toBeNull();
    expect(codChangeOf(tracking("Consignment marked as partially delivered by rider. Note: Cod 120 tk hbe"))).toBeNull();
    // A rider quoting the courier's own sentence inside a note is still a note.
    expect(codChangeOf(tracking('Rider Note: "Amount has been changed from "1510" to "120""'))).toBeNull();
    expect(codChangeOf({ notification_type: "delivery_status", status: "delivered", cod_amount: 120 })).toBeNull();
  });

  it("is null for an unreadable amount, never 0", () => {
    for (const v of ["abc", -5, null, "", Number.NaN]) expect(codChangeOf({ ...merchantEdit, values: { cod_amount: v } })).toBeNull();
    expect(codChangeOf(null)).toBeNull();
    expect(codChangeOf("x")).toBeNull();
  });

  it("keeps the change when the time is missing or not a time", () => {
    expect(codChangeOf({ ...merchantEdit, updated_at: undefined })).toMatchObject({ to: 120, at: null });
    expect(codChangeOf({ ...merchantEdit, updated_at: "yesterday" })).toMatchObject({ to: 120, at: null });
  });
});
