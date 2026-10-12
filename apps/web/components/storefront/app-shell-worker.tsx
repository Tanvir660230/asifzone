"use client";

import { useEffect } from "react";
import { useInstallAppStore, type BeforeInstallPromptEvent } from "@/store/install-app";

/** Registers the storefront's service worker (offline page + push, public/sw.js) and holds the browser's install offer for
 * <InstallAppCard>. Production only: a worker in development would outlive code changes. Renders nothing. */
export function AppShellWorker() {
  const setDeferred = useInstallAppStore((s) => s.setDeferred);
  const markInstalled = useInstallAppStore((s) => s.markInstalled);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      // After the page has loaded, so registering never competes with what the shopper came for.
      const register = () => navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, [setDeferred, markInstalled]);

  return null;
}
