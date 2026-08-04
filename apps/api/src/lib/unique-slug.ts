type SlugChecker = (slug: string) => Promise<boolean>;

/** Appends -2, -3, ... to a base slug until `exists` reports it's free. */
export async function ensureUniqueSlug(baseSlug: string, exists: SlugChecker): Promise<string> {
  let candidate = baseSlug;
  let attempt = 1;
  while (await exists(candidate)) {
    attempt += 1;
    candidate = `${baseSlug}-${attempt}`;
  }
  return candidate;
}
