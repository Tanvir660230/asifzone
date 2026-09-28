import Script from "next/script";

/** Same "inert until configured" pattern as HeatmapScript: wires up the Meta (Facebook) Pixel
 * base snippet once NEXT_PUBLIC_META_PIXEL_ID is set at build time. Fires the initial PageView
 * itself; subsequent client-side route changes are tracked from PageViewTracker via fbq directly
 * since this script only ever runs once per full page load. */
export function MetaPixelScript() {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  if (!pixelId) return null;

  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s)
      {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)}(window, document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${pixelId}');
      fbq('track', 'PageView');`}
    </Script>
  );
}
