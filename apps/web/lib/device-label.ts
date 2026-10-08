/** "Chrome on Windows" from a user-agent string — enough to recognise a device, not a fingerprint. */
export function describeDevice(userAgent: string | null): { label: string; phone: boolean } {
  if (!userAgent) return { label: "Unknown device", phone: false };
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const phone = /iPhone|Android.*Mobile|Mobile Safari/.test(ua);
  if (!browser && !os) return { label: "Unknown device", phone };
  return { label: browser && os ? `${browser} on ${os}` : (browser ?? os)!, phone };
}
