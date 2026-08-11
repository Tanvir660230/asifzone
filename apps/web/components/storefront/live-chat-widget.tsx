import Script from "next/script";
import type { StoreSettings } from "@clothing-brand/shared";

interface LiveChatWidgetProps {
  settings: StoreSettings;
}

/** "Live Chat": wires up Tawk.to (free, no backend of our own to run) whenever an admin turns it on
 * in Settings and sets the property/widget IDs — DB-driven so it can be toggled without a rebuild
 * (unlike the old NEXT_PUBLIC_TAWKTO_* build-time env vars). Tawk's own floating launcher bubble is
 * hidden on load; ContactWidget's "Live Chat" action calls `window.Tawk_API.toggle()` instead, so
 * there's exactly one floating contact button on the page. */
export function LiveChatWidget({ settings }: LiveChatWidgetProps) {
  if (!settings.liveChatEnabled || !settings.tawkPropertyId || !settings.tawkWidgetId) return null;

  return (
    <Script id="tawkto-live-chat" strategy="afterInteractive">
      {`var Tawk_API = Tawk_API || {};
        Tawk_API.onLoad = function () { Tawk_API.hideWidget(); };
        (function () {
          var s1 = document.createElement("script"), s0 = document.getElementsByTagName("script")[0];
          s1.async = true;
          s1.src = "https://embed.tawk.to/${settings.tawkPropertyId}/${settings.tawkWidgetId}";
          s1.charset = "UTF-8";
          s1.setAttribute("crossorigin", "*");
          s0.parentNode.insertBefore(s1, s0);
        })();`}
    </Script>
  );
}
