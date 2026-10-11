"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/account/password-input";
import { toast } from "@/components/ui/toast";
import { changeCustomerPassword, logoutEverywhere } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

/** Phase 11 (BD-11.3): set/change the password (every other session is signed out) and sign out of every device. */
export function AccountSecurity({ hasEmail }: { hasEmail: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await changeCustomerPassword({ currentPassword: currentPassword || undefined, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password updated — other devices were signed out");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update your password");
    } finally {
      setBusy(false);
    }
  }

  async function onLogoutEverywhere() {
    await logoutEverywhere();
    router.replace("/account/login");
  }

  const tooShort = newPassword.length > 0 && newPassword.length < 8;

  return (
    <div className="space-y-6">
      {hasEmail && (
        <form onSubmit={onChangePassword} className="space-y-4">
          <div>
            <Label htmlFor="current-password">Current password</Label>
            <PasswordInput id="current-password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            <p className="ui-field-hint">Leave empty if you signed up with Google or a phone code.</p>
          </div>
          <div>
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              aria-describedby="new-password-hint"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <p id="new-password-hint" className={tooShort ? "ui-field-error" : "ui-field-hint"}>
              {tooShort ? `${8 - newPassword.length} more characters needed` : "At least 8 characters."}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger-600">
              {error}
            </p>
          )}
          <Button type="submit" loading={busy} disabled={newPassword.length < 8}>
            Update password
          </Button>
        </form>
      )}
      <div className={hasEmail ? "border-t border-line-subtle pt-5" : undefined}>
        <p className="text-sm font-medium text-fg">Signed in somewhere you don&rsquo;t recognise?</p>
        <p className="mt-0.5 text-sm text-fg-muted">This signs you out on every device, including this one.</p>
        <Button type="button" variant="outline" className="mt-3" onClick={onLogoutEverywhere}>
          Sign out of all devices
        </Button>
      </div>
    </div>
  );
}
