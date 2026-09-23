/**
 * A browser-side marker that says "an admin has been logged in here", nothing more.
 *
 * The admin session itself is an httpOnly cookie the page can't read. The storefront wants to show a few admin-only figures
 * (like units sold in the last 7 days) without making *every customer's* browser ask the API whether it is an admin. So the admin
 * area sets this marker while a session is verified, and the storefront only asks the API when the marker is present.
 *
 * It is a convenience, not security: the API decides who gets the data (it refuses anyone without a valid admin session), so
 * setting the cookie by hand only makes the browser send a request that gets a 401.
 */
const NAME = "az_admin_hint";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

const secure = () => (typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "");

export function hasAdminHint(): boolean {
  return typeof document !== "undefined" && document.cookie.split("; ").includes(`${NAME}=1`);
}

export function setAdminHint(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${NAME}=1; path=/; max-age=${THIRTY_DAYS}; SameSite=Lax${secure()}`;
}

export function clearAdminHint(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${NAME}=; path=/; max-age=0; SameSite=Lax${secure()}`;
}
