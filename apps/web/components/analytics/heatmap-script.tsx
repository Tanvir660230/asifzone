import Script from "next/script";

/** "Heatmap ready": wires up Microsoft Clarity (free, no separate backend to run) the moment an
 * admin sets NEXT_PUBLIC_CLARITY_ID at build time — same build-time-only constraint as
 * NEXT_PUBLIC_API_URL, since Next inlines NEXT_PUBLIC_* vars into the client bundle. Renders
 * nothing until that's set; swap the snippet below for a different provider if preferred. */
export function HeatmapScript() {
  const clarityId = process.env.NEXT_PUBLIC_CLARITY_ID;
  if (!clarityId) return null;

  return (
    <Script id="ms-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", "${clarityId}");`}
    </Script>
  );
}
