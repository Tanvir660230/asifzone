/**
 * sessionStorage that never throws. A browser that blocks site data (cookies off, some in-app browsers) throws a
 * SecurityError on the mere `window.sessionStorage` access — on the checkout that turned a placed order into an error
 * message, because the "remember this phone" write came after the order was created. Reads come back null and writes are
 * skipped instead; nothing that uses them is essential.
 */
export function sessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function sessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // storage unavailable — skip
  }
}
