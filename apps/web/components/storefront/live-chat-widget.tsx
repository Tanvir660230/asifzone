"use client";

import { useEffect } from "react";
import type { StoreSettings } from "@clothing-brand/shared";

interface LiveChatWidgetProps {
  settings: StoreSettings;
}

interface TawkApi {
  onLoad?: () => void;
  hideWidget?: () => void;
}

/** "Live Chat": wires up Tawk.to (free, no backend of our own to run) whenever an admin turns it on
 * in Settings and sets the property/widget IDs — DB-driven so it can be toggled without a rebuild
 * (unlike the old NEXT_PUBLIC_TAWKTO_* build-time env vars). Tawk's own floating launcher bubble is
 * hidden on load; ContactWidget's "Live Chat" action calls `window.Tawk_API.toggle()` instead, so
 * there's exactly one floating contact button on the page. The loader is a script element created
 * from this bundle rather than an inline snippet, so the nonce-based CSP's 'strict-dynamic' trusts it
 * (middleware.ts). A functional widget the shopper opens, so not behind the tracking consent. */
export function LiveChatWidget({ settings }: LiveChatWidgetProps) {
  const { liveChatEnabled, tawkPropertyId, tawkWidgetId } = settings;

  useEffect(() => {
    if (!liveChatEnabled || !tawkPropertyId || !tawkWidgetId) return;
    const w = window as unknown as { Tawk_API?: TawkApi; Tawk_LoadStart?: Date };
    if (w.Tawk_API) return;
    w.Tawk_API = { onLoad: () => w.Tawk_API?.hideWidget?.() };
    w.Tawk_LoadStart = new Date();
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://embed.tawk.to/${encodeURIComponent(tawkPropertyId)}/${encodeURIComponent(tawkWidgetId)}`;
    script.charset = "UTF-8";
    script.setAttribute("crossorigin", "*");
    document.head.appendChild(script);
  }, [liveChatEnabled, tawkPropertyId, tawkWidgetId]);

  return null;
}
