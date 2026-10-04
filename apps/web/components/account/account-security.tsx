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

  return (
    <div className="max-w-md space-y-4">
      {hasEmail && (
        <form onSubmit={onChangePassword} className="space-y-3">
          <div>
            <Label htmlFor="current-password">Current password (leave empty if you haven&rsquo;t set one)</Label>
            <PasswordInput id="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput id="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          {error && <p className="text-sm text-danger-600">{error}</p>}
          <Button type="submit" variant="brass" disabled={busy || newPassword.length < 8}>
            {busy ? "Saving…" : "Update password"}
          </Button>
        </form>
      )}
      <div>
        <Button type="button" variant="outline" onClick={onLogoutEverywhere}>
          Sign out of all devices
        </Button>
      </div>
    </div>
  );
}
