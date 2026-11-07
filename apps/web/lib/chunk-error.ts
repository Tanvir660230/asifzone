/** A piece of the site's code that failed to download — a weak connection, or a page opened before a deploy asking for
 * files the new build no longer has. A fresh page load fetches the current files and usually just works, which the
 * error screen's "Try again" (a re-render with the same missing file) never did. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || /Loading (CSS )?chunk [\w-]+ failed/i.test(error.message);
}

/** One of the site's own script files arrived cut off (a dropped mobile connection mid-download): the browser reports a
 * SyntaxError at that file, with no stack ("Unexpected end of input", "Invalid or unexpected token"). Same cure as a
 * missing chunk. */
export function isTruncatedScriptError(error: unknown, filename: string | undefined): boolean {
  if (!filename || !/\/_next\/static\//.test(filename)) return false;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return name === "SyntaxError" || /^(Uncaught )?SyntaxError/.test(message);
}

/** Session key holding when the page last reloaded itself for a chunk error. */
export const CHUNK_RELOAD_KEY = "chunk-reload-at";
const RELOAD_GUARD_MS = 60_000;

/** Reload at most once a minute: a chunk that is really gone must show the error screen, not reload forever. */
export function shouldReloadForChunkError(lastReloadAt: string | null, now = Date.now()): boolean {
  return !lastReloadAt || now - Number(lastReloadAt) > RELOAD_GUARD_MS;
}
