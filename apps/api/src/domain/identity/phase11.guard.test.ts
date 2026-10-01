import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Phase 11 architecture guards (docs/PHASE_11_IMPLEMENTATION_CONTRACT.md §9, §12).

const API = join(__dirname, "..", "..");
const MIGRATIONS = join(API, "..", "prisma", "migrations");
const code = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|\/\*)/.test(l))
    .join("\n");
const read = (rel: string) => code(join(API, rel));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}
const source = files(API).filter((f) => !/test-(fixtures|routes|guard|setup)\.ts$/.test(f));
const fnBody = (src: string, name: string) => {
  const start = src.indexOf(`export async function ${name}(`);
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
};

describe("Phase 11 — identity, sessions, observability guards", () => {
  it("phone-based customer lookups always state the verification condition (no raw phone authentication)", () => {
    const offenders: string[] = [];
    for (const f of source) {
      const src = code(f);
      for (const m of src.matchAll(/customer\.(findFirst|findMany)\(\{[\s\S]{0,200}?where:\s*\{([^}]*)\}/g)) {
        const where = m[2]!;
        if (/\bphone\b/.test(where) && !/phoneVerifiedAt/.test(where)) offenders.push(`${relative(API, f)}: ${where.trim().slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(fnBody(read("modules/customers/customer.service.ts"), "verifyOtp")).toMatch(/findVerifiedPhoneOwner\(input\.phone/);
    expect(read("modules/customers/customer-identity.ts")).toMatch(/phoneVerifiedAt: \{ not: null \}/);
  });

  it("only the identity code marks a phone verified", () => {
    const writers = source.filter((f) => /phoneVerifiedAt:\s*(now|new Date\(\))/.test(code(f))).map((f) => relative(API, f).replace(/\\/g, "/"));
    expect(writers.sort()).toEqual(["modules/customers/customer.service.ts"]);
  });

  it("registration never writes to an existing record (claims go through the emailed proof)", () => {
    const register = fnBody(read("modules/customers/customer.service.ts"), "registerCustomer");
    expect(register).not.toMatch(/customer\.(update|updateMany|upsert)\(/);
    expect(register).toMatch(/startEmailClaim\(/);
    // Claims attach credentials only under the placeholder condition, atomically.
    expect(fnBody(read("modules/customers/customer.service.ts"), "confirmEmailClaim")).toMatch(/where: \{ id: claim\.customerId, passwordHash: null, googleId: null, phoneVerifiedAt: null \}/);
  });

  it("Google sign-in checks email_verified before any account is created, linked or signed in (customer and admin)", () => {
    const customer = read("modules/customers/customer.service.ts");
    const google = fnBody(customer, "signInWithGoogleIdentity");
    expect(google.indexOf("emailVerified !== true")).toBeGreaterThan(-1);
    expect(google.indexOf("emailVerified !== true")).toBeLessThan(google.indexOf("googleId"));
    expect(customer).toMatch(/emailVerified: payload\.email_verified/);
    const admin = read("modules/auth/auth.service.ts");
    const adminGoogle = fnBody(admin, "signInAdminWithGoogleIdentity");
    expect(adminGoogle.indexOf("emailVerified !== true")).toBeLessThan(adminGoogle.indexOf("googleId"));
    expect(admin).toMatch(/emailVerified: payload\.email_verified/);
  });

  it("no console.* outside the logger; the SMS dev log never includes the message body (it can be an OTP)", () => {
    const offenders = source.filter((f) => !/observability/.test(f) && /console\.(log|warn|error|info|debug)\(/.test(code(f))).map((f) => relative(API, f));
    expect(offenders).toEqual([]);
    expect(read("lib/sms.ts")).toMatch(/bodyLength: body\.length/);
    expect(read("lib/sms.ts")).not.toMatch(/Body: \$\{body\}/);
    expect(read("lib/observability/logger.ts")).toMatch(/pass\(word\|code\)\?\|otp\|\^code\$\|token\|secret/);
  });

  it("observability never writes business state", () => {
    for (const f of ["lib/observability/logger.ts", "lib/observability/error-capture.ts", "lib/observability/context.ts", "lib/observability/jobs.ts", "modules/ops/readiness.ts"]) {
      expect(read(f), f).not.toMatch(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/);
    }
    expect(read("lib/observability/error-capture.ts")).not.toMatch(/prisma/);
  });

  it("correlation IDs propagate: outbox writer stamps them, delivery runs in them, every job runs in a context", () => {
    expect(read("domain/outbox/outbox.ts")).toMatch(/correlationId = currentCorrelationId\(\)/);
    expect(read("domain/outbox/processor.ts")).toMatch(/runWithContext\(ctx, \(\) => consumer\.handle\(/);
    const jobs = readdirSync(join(API, "jobs")).map((f) => code(join(API, "jobs", f)));
    for (const j of jobs) expect(j).not.toMatch(/new Worker\(/);
    expect(read("app.ts")).toMatch(/app\.use\(correlationMiddleware\)/);
  });

  it("the attention endpoint uses the existing permission (ops.read) or the integration token — no second permission system", () => {
    const attention = read("modules/ops/attention.ts");
    expect(attention).toMatch(/requirePermission\("ops\.read"\)/);
    expect(attention).toMatch(/constantTimeEqual\(/);
    expect(attention).not.toMatch(/role\s*[!=]==/);
  });

  it("the legacy price-adjustment path does money in minor units — no Number() arithmetic (F-20)", () => {
    const adjust = fnBody(read("modules/orders/order.service.ts"), "adjustOrderPrice");
    expect(adjust).not.toMatch(/Number\([^)]*\)\s*[-+*/]\s*Number\(/);
    expect(adjust).toMatch(/clampNonNegative\(subtract\(m\(existing\.discount\), bundle\)\)/);
  });

  it("no destructive migration after the two early ones; the Phase 11 migration is additive with the partial index", () => {
    const destructive = /DROP\s+(TABLE|COLUMN)|ALTER\s+COLUMN\s+\S+\s+(TYPE|SET NOT NULL)|DROP\s+TYPE|RENAME\s+(COLUMN|TO)|DELETE\s+FROM|TRUNCATE/i;
    const allowedEarly = new Set(["20260805063035_add_social_links", "20260805112438_zone_based_shipping"]);
    const offenders = readdirSync(MIGRATIONS)
      .filter((d) => statSync(join(MIGRATIONS, d)).isDirectory() && !allowedEarly.has(d))
      .filter((d) => destructive.test(readFileSync(join(MIGRATIONS, d, "migration.sql"), "utf8").replace(/--.*$/gm, "")));
    expect(offenders).toEqual([]);
    const p11 = readFileSync(join(MIGRATIONS, "20261006100000_phase11_customer_identity", "migration.sql"), "utf8");
    expect(p11).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "Customer_phone_verified_key" ON "Customer" \("phone"\) WHERE "phoneVerifiedAt" IS NOT NULL/);
    expect(p11).not.toMatch(/UPDATE\s+"Customer"/i); // no backfill: nothing auto-verified
  });
});
