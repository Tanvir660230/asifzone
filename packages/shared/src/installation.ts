/**
 * Installation identity and the Redis/cache namespace derived from it (Phase 1C) — the ONE place that turns an
 * installation id into key, lock, queue and cache-tag names, used by the API (cache, locks, BullMQ) and the web app
 * (Next.js data-cache tags) alike.
 *
 * An installation is one store's deployment: its own database, Redis namespace, uploads volume and runtime config
 * (docs/STORE_DEPLOYMENT.md). Several installations may share one Redis server; everything they write there lives under
 * `install:<id>:`, so two stores can never read, overwrite, lock or consume each other's entries.
 */

/** Lowercase letters, digits and dashes, starting with a letter or digit — safe inside Redis keys, BullMQ prefixes,
 * Docker project names and cache tags. */
export const INSTALL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export class InvalidInstallIdError extends Error {
  constructor(value: string) {
    super(`INSTALL_ID must match ${INSTALL_ID_PATTERN} (lowercase letters, digits and dashes) — got "${value}"`);
    this.name = "InvalidInstallIdError";
  }
}

export function assertInstallId(value: string): string {
  if (!INSTALL_ID_PATTERN.test(value)) throw new InvalidInstallIdError(value);
  return value;
}

export interface InstallationNamespace {
  readonly installId: string;
  /** Prefix shared by every Redis key of this installation (`install:<id>:`). */
  readonly root: string;
  /** A cache entry key: `install:<id>:cache:<key>`. */
  cache(key: string): string;
  /** A distributed-lock key: `install:<id>:lock:<key>`. */
  lock(key: string): string;
  /** BullMQ's `prefix` option (queue names stay as they are; BullMQ puts this in front of every key it writes). */
  readonly queuePrefix: string;
  /** A Next.js data-cache tag: `install:<id>:<tag>`. */
  cacheTag(tag: string): string;
}

export function installationNamespace(installId: string): InstallationNamespace {
  const id = assertInstallId(installId);
  const root = `install:${id}:`;
  return {
    installId: id,
    root,
    cache: (key) => `${root}cache:${key}`,
    lock: (key) => `${root}lock:${key}`,
    queuePrefix: `${root}bull`,
    cacheTag: (tag) => `${root}${tag}`,
  };
}
