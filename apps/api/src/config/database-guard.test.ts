import { describe, it, expect } from "vitest";
import { applyDatabaseUrlPolicy, verifyDatabaseRole } from "./database-guard";

const local = (db: string) => `postgresql://postgres@localhost:5432/${db}?schema=public`;

describe("applyDatabaseUrlPolicy", () => {
  it("refuses a remote database outside production", () => {
    for (const nodeEnv of ["development", "test", "staging"]) {
      expect(() => applyDatabaseUrlPolicy("postgresql://postgres:x@187.77.137.12:5432/clothing_brand", nodeEnv, {})).toThrow(/only use a database on this machine/);
      expect(() => applyDatabaseUrlPolicy("postgresql://postgres:x@asifzone.com/clothing_brand", nodeEnv, {})).toThrow(/only use a database on this machine/);
    }
  });

  it("allows loopback databases outside production", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(applyDatabaseUrlPolicy(`postgresql://postgres@${host}:5432/clothing_brand`, "development", {}).database).toBe("clothing_brand");
    }
  });

  it("lets production use its private-network host but never a demo database", () => {
    expect(applyDatabaseUrlPolicy("postgresql://postgres:x@postgres:5432/clothing_brand", "production", {}).host).toBe("postgres");
    expect(() => applyDatabaseUrlPolicy("postgresql://postgres:x@postgres:5432/asifzone_demo", "production", {})).toThrow(/demo database/);
  });

  it("refuses the half-built staging import", () => {
    expect(() => applyDatabaseUrlPolicy(local("asifzone_demo_staging"), "development", {})).toThrow(/half-built/);
  });

  it("forces live providers off on the demo database unless explicitly overridden", () => {
    const environment: Record<string, string | undefined> = {};
    applyDatabaseUrlPolicy(local("asifzone_demo"), "development", environment);
    expect(environment.LIVE_PROVIDERS).toBe("off");

    const overridden: Record<string, string | undefined> = { DEMO_LIVE_PROVIDERS: "on" };
    applyDatabaseUrlPolicy(local("asifzone_demo"), "development", overridden);
    expect(overridden.LIVE_PROVIDERS).toBeUndefined();

    const other: Record<string, string | undefined> = {};
    applyDatabaseUrlPolicy(local("clothing_brand"), "development", other);
    expect(other.LIVE_PROVIDERS).toBeUndefined();
  });
});

describe("verifyDatabaseRole", () => {
  const client = (role: string | null, database: string) => ({
    $queryRawUnsafe: async <T>() => [{ role, database, imported_at: role === "demo" ? "2026-10-06T00:00:00Z" : null }] as T,
  });

  it("accepts the marked demo database and ordinary databases", async () => {
    await expect(verifyDatabaseRole(client("demo", "asifzone_demo"), "development")).resolves.toMatchObject({ role: "demo" });
    await expect(verifyDatabaseRole(client(null, "clothing_brand"), "development")).resolves.toMatchObject({ role: null });
    await expect(verifyDatabaseRole(client(null, "clothing_brand"), "production")).resolves.toMatchObject({ role: null });
  });

  it("refuses inconsistent or unfinished demo databases", async () => {
    await expect(verifyDatabaseRole(client("demo-staging", "asifzone_demo_staging"), "development")).rejects.toThrow(/half-built/);
    await expect(verifyDatabaseRole(client("demo", "asifzone_demo"), "production")).rejects.toThrow(/production/);
    await expect(verifyDatabaseRole(client("demo", "renamed_copy"), "development")).rejects.toThrow(/not named asifzone_demo/);
    await expect(verifyDatabaseRole(client(null, "asifzone_demo"), "development")).rejects.toThrow(/no demo marker/);
  });
});
