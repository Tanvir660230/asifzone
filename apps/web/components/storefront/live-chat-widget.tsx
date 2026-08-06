import Script from "next/script";

/** "Live Chat": wires up Tawk.to (free, no backend of our own to run) the moment an admin sets
 * NEXT_PUBLIC_TAWKTO_PROPERTY_ID + NEXT_PUBLIC_TAWKTO_WIDGET_ID at build time — same build-time-only
 * constraint as the other NEXT_PUBLIC_* integrations, since Next inlines them into the client bundle.
 * Renders nothing until both are set; swap the snippet below for a different provider if preferred. */
export function LiveChatWidget() {
  const propertyId = process.env.NEXT_PUBLIC_TAWKTO_PROPERTY_ID;
  const widgetId = process.env.NEXT_PUBLIC_TAWKTO_WIDGET_ID;
  if (!propertyId || !widgetId) return null;

  return (
    <Script id="tawkto-live-chat" strategy="afterInteractive">
      {`var Tawk_API = Tawk_API || {};
        (function () {
          var s1 = document.createElement("script"), s0 = document.getElementsByTagName("script")[0];
          s1.async = true;
          s1.src = "https://embed.tawk.to/${propertyId}/${widgetId}";
          s1.charset = "UTF-8";
          s1.setAttribute("crossorigin", "*");
          s0.parentNode.insertBefore(s1, s0);
        })();`}
    </Script>
  );
}
