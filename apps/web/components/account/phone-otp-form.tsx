"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestOtp, verifyOtp } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

const RESEND_COOLDOWN_SECONDS = 60;
const NEW_PHONE_ERROR = "NEW_PHONE_NEEDS_PROFILE";

type Step = "phone" | "code";

/** Handles both sign-in and sign-up: verifying a code for an already-registered phone logs that
 * customer in directly; verifying a new number requires name+email once (revealed inline, no
 * second SMS needed) since a phone code alone doesn't establish an email address. */
export function PhoneOtpForm({ onSuccess }: { onSuccess: (customer: Customer) => void }) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [needsProfile, setNeedsProfile] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function sendCode() {
    setError(null);
    setLoading(true);
    try {
      await requestOtp({ phone });
      setStep("code");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the code, please try again");
    } finally {
      setLoading(false);
    }
  }

  async function submitCode() {
    setError(null);
    setLoading(true);
    try {
      const { customer } = await verifyOtp({
        phone,
        code,
        name: needsProfile ? name : undefined,
        email: needsProfile ? email : undefined,
      });
      onSuccess(customer);
    } catch (err) {
      if (err instanceof ApiError && err.message === NEW_PHONE_ERROR) {
        setNeedsProfile(true);
        setError("New number — enter your name and email to finish creating your account.");
      } else {
        setError(err instanceof ApiError ? err.message : "Verification failed, please try again");
      }
    } finally {
      setLoading(false);
    }
  }

  if (step === "phone") {
    return (
      <div className="space-y-3">
        <div>
          <Label htmlFor="otp-phone">Phone number</Label>
          <Input
            id="otp-phone"
            type="tel"
            placeholder="01XXXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />
        </div>
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <Button type="button" variant="outline" className="w-full" onClick={sendCode} disabled={loading || !phone}>
          {loading ? "Sending…" : "Send code"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="otp-code">Verification code</Label>
        <Input
          id="otp-code"
          inputMode="numeric"
          maxLength={6}
          placeholder="6-digit code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
      </div>

      {needsProfile && (
        <>
          <div>
            <Label htmlFor="otp-name">Full name</Label>
            <Input id="otp-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div>
            <Label htmlFor="otp-email">Email</Label>
            <Input
              id="otp-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
        </>
      )}

      {error && <p className="text-sm text-danger-600">{error}</p>}

      <Button type="button" variant="outline" className="w-full" onClick={submitCode} disabled={loading || code.length !== 6}>
        {loading ? "Verifying…" : "Verify & continue"}
      </Button>

      <div className="flex items-center justify-between text-xs text-ink-500">
        <button
          type="button"
          onClick={() => {
            setStep("phone");
            setNeedsProfile(false);
            setError(null);
          }}
          className="underline hover:text-ink-700"
        >
          Change number
        </button>
        <button
          type="button"
          onClick={sendCode}
          disabled={cooldown > 0 || loading}
          className="underline hover:text-ink-700 disabled:pointer-events-none disabled:opacity-50"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
      </div>
    </div>
  );
}
