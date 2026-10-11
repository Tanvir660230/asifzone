/**
 * Seed OWNER credentials (Phase 11, F-14). The public-repo defaults exist only for local development and tests — the same
 * allowlist as config/env.ts (`development` | `test`). Anywhere else (production, staging, a typo'd NODE_ENV) the seed
 * requires SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD and refuses the well-known defaults outright.
 */
export const DEV_SEED_ADMIN = { email: "admin@example.com", password: "ChangeMe123!" } as const;

export interface SeedAdminCredentials {
  email: string;
  password: string;
  usedDefaults: boolean;
}

export function resolveSeedAdminCredentials(environment: Record<string, string | undefined> = process.env): SeedAdminCredentials {
  const nodeEnv = environment.NODE_ENV ?? "development";
  const devLike = nodeEnv === "development" || nodeEnv === "test";
  const email = environment.SEED_ADMIN_EMAIL?.trim();
  const password = environment.SEED_ADMIN_PASSWORD;

  if (!devLike) {
    if (!email || !password) {
      throw new Error(`SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required when NODE_ENV="${nodeEnv}" — the built-in defaults are for local development and tests only.`);
    }
    if (email.toLowerCase() === DEV_SEED_ADMIN.email || password === DEV_SEED_ADMIN.password) {
      throw new Error(`Refusing the default seed OWNER credentials when NODE_ENV="${nodeEnv}" — choose a real email and password.`);
    }
    return { email, password, usedDefaults: false };
  }
  return { email: email || DEV_SEED_ADMIN.email, password: password || DEV_SEED_ADMIN.password, usedDefaults: !email || !password };
}
