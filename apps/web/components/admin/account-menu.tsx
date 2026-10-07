"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Keyboard, LogOut, ShieldOff } from "lucide-react";
import { logoutAdmin, logoutAllDevices } from "@/lib/auth";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Popover } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";

/** "Store Owner" -> "SO" — fallback avatar monogram, same convention as the storefront header's logo fallback. */
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Display names for the roles (naming only — what an admin may do comes from useCapability). */
const ROLE_NAMES: Record<string, string> = { OWNER: "Owner", STAFF: "Staff" };

/** The toolbar's avatar and its menu: who is signed in, keyboard shortcuts, and signing out (here or everywhere). */
export function AccountMenu({ onShowShortcuts }: { onShowShortcuts: () => void }) {
  const { data, isLoading } = useCurrentAdmin();
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [open, setOpen] = useState(false);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const admin = data?.admin;

  async function handleLogout() {
    setOpen(false);
    await logoutAdmin();
    router.replace("/admin/login");
  }

  async function handleLogoutEverywhere() {
    setOpen(false);
    if (!(await confirm("Sign out of every device and browser signed in as you? You'll need to log in again here too.")))
      return;
    setSigningOutEverywhere(true);
    try {
      await logoutAllDevices();
      router.replace("/admin/login");
    } catch {
      toast.error("Couldn't sign out of all devices — try again.");
      setSigningOutEverywhere(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={admin ? `Account: ${admin.name}` : "Account"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[11px] font-semibold text-ink-700 transition-shadow duration-fast ease-smooth hover:ring-4 hover:ring-ink-900/[0.06]"
      >
        {isLoading || !admin ? "…" : getInitials(admin.name)}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} align="end" className="w-60 p-1.5">
        {admin && (
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-semibold text-fg">{admin.name}</p>
            <p className="truncate text-xs text-fg-muted">
              {admin.email} · {ROLE_NAMES[admin.role] ?? admin.role}
            </p>
          </div>
        )}
        <div className="my-1 border-t border-line-subtle" />
        <button
          type="button"
          className="ui-menu-item"
          onClick={() => {
            setOpen(false);
            onShowShortcuts();
          }}
        >
          <Keyboard size={15} aria-hidden />
          Keyboard shortcuts
        </button>
        <div className="my-1 border-t border-line-subtle" />
        <button type="button" className="ui-menu-item" onClick={handleLogout}>
          <LogOut size={15} aria-hidden />
          Log out
        </button>
        <button type="button" className="ui-menu-item" onClick={handleLogoutEverywhere} disabled={signingOutEverywhere}>
          <ShieldOff size={15} aria-hidden />
          {signingOutEverywhere ? "Signing out everywhere…" : "Log out of all devices"}
        </button>
      </Popover>
      {confirmDialog}
    </>
  );
}
