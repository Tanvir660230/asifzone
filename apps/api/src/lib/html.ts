const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes user-controlled text before it's interpolated into an HTML email template. Customer
 * names are freely chosen at registration with no sanitization, so anything built from one — e.g.
 * "Hi ${customer.name}," in a transactional email — needs this or it's a stored-XSS vector. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]!);
}
