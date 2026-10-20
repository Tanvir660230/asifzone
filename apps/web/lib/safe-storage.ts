/**
 * sessionStorage that never throws. A browser that blocks site data (cookies off, some in-app browsers) throws a
 * SecurityError on the mere `window.sessionStorage` access — on the checkout that turned a placed order into an error
 * message, because the "remember this phone" write came after the order was created. There, values are kept in memory
 * instead: they last until the page is reloaded, which covers the in-app hop from checkout to the order confirmation.
 */
const memory = new Map<string, string>();

export function sessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function sessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}
