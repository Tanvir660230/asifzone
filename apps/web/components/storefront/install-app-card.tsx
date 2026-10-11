"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useInstallAppStore } from "@/store/install-app";
import { getSettings } from "@/lib/api/settings";

const DISMISS_KEY = "az_install_dismissed_at";
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

/** iPhone/iPad Safari: no install offer from the browser — the shopper adds it from the Share menu themselves. */
function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** "Add the store to your home screen": an inline card for moments a shopper is likely to come back (after an order, in
 * their account). Shown only when the browser can install it (or on iOS Safari, with the two-tap instructions), never
 * once installed, and not again for 30 days after "Not now". */
export function InstallAppCard({ className }: { className?: string }) {
  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 5 * 60 * 1000 });
  const storeName = settingsData?.settings.storeName ?? "this store";
  const deferred = useInstallAppStore((s) => s.deferred);
  const installed = useInstallAppStore((s) => s.installed);
  const markInstalled = useInstallAppStore((s) => s.markInstalled);
  const [mode, setMode] = useState<"prompt" | "ios" | null>(null);

  useEffect(() => {
    if (isStandalone() || installed || dismissedRecently()) return setMode(null);
    if (deferred) return setMode("prompt");
    setMode(isIosSafari() ? "ios" : null);
  }, [deferred, installed]);

  if (!mode) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Storage blocked: the card simply comes back next visit.
    }
    setMode(null);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") markInstalled();
    else dismiss();
  }

  return (
    <div className={cn("relative flex items-start gap-4 rounded-2xl bg-surface p-5 ring-1 ring-inset ring-line-subtle", className)} data-testid="install-app">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-900">
        <Smartphone size={20} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 pr-6">
        <p className="font-medium text-ink-900">Add {storeName} to your home screen</p>
        {mode === "prompt" ? (
          <>
            <p className="mt-1 text-sm text-ink-600">One tap to shop and track your orders, like an app. No download from a store.</p>
            <Button size="sm" className="mt-3" onClick={install}>
              Add to home screen
            </Button>
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-600">
            Tap <Share size={14} aria-label="Share" className="inline-block align-[-2px]" /> in Safari, then <span className="font-medium text-ink-900">Add to Home Screen</span>.
          </p>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label="Not now" className="absolute right-2 top-2 rounded-full p-2 text-ink-500 transition-colors hover:bg-surface-muted hover:text-ink-900">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
