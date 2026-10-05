/** The single consent gate for every ad pixel. The store has no consent banner today (the privacy policy discloses the
 * pixels), so this grants. When a consent banner/CMP is added, return its stored "marketing" decision here — every ad
 * event in lib/pixels/ is already checked against it before any guard runs or any script loads, so nothing is tracked
 * (or downloaded) before consent. TikTok also offers ttq.holdConsent()/grantConsent()/revokeConsent() for that day. */
export function hasAdTrackingConsent(): boolean {
  return true;
}
