"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmPhoneVerification, requestPhoneVerification } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

/** Phase 11 (BD-11.1): a phone becomes the customer's sign-in phone only after a code sent to it is confirmed. Used to verify
 * the current phone for the first time, or to change a verified sign-in phone (the old one keeps working until then). */
export function PhoneVerificationPanel({ initialPhone, onVerified, onCancel }: { initialPhone?: string; onVerified: () => void; onCancel?: () => void }) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await requestPhoneVerification({ phone });
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send a code, please try again");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await confirmPhoneVerification({ phone, code });
      onVerified();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't verify this code, please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-ink-100 p-4">
      {step === "phone" ? (
        <div>
          <Label htmlFor="verify-phone">Phone number to verify</Label>
          <Input id="verify-phone" placeholder="01XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      ) : (
        <div>
          <Label htmlFor="verify-code">Code sent to {phone}</Label>
          <Input id="verify-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
      )}
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <div className="flex gap-2">
        {step === "phone" ? (
          <Button type="button" variant="brass" disabled={busy || !phone} onClick={sendCode}>
            {busy ? "Sending…" : "Send code"}
          </Button>
        ) : (
          <Button type="button" variant="brass" disabled={busy || code.length !== 6} onClick={confirm}>
            {busy ? "Verifying…" : "Verify"}
          </Button>
        )}
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
