import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Phase 12 (docs/PHASE_12_IMPLEMENTATION_CONTRACT.md §21): the provider boundary. Application/domain code reaches providers
// only through providers/registry.ts (+ the capability types and error vocabulary); only the registry selects; only
// config/env.ts and providers/** read provider credentials; nothing credential-shaped reaches the web app or the schema.
// Every rule is a pure function over {path, text} so its own mutation check (a planted violation) runs here too.

const ROOT = join(__dirname, "..", "..", "..", "..");
const API_SRC = join(ROOT, "apps", "api", "src");
const WEB_DIRS = ["app", "components", "lib", "hooks"].map((d) => join(ROOT, "apps", "web", d));

type Source = { path: string; text: string };

function files(dir: string, includeTests = false): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name === ".next" ? [] : files(full, includeTests);
    if (!/\.(ts|tsx)$/.test(full)) return [];
    return includeTests || !/\.test\.tsx?$/.test(full) ? [full] : [];
  });
}

function code(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|\/\*|\{\/\*)/.test(l))
    .map((l) => l.replace(/\s\/\/.*$/, ""))
    .join("\n");
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");
const apiSources = (): Source[] => files(API_SRC).map((f) => ({ path: rel(f), text: code(f) }));
const webSources = (): Source[] => WEB_DIRS.flatMap((d) => files(d)).map((f) => ({ path: rel(f), text: code(f) }));
const inProviders = (p: string) => p.startsWith("apps/api/src/providers/");

// ── Rules ──────────────────────────────────────────────────────────────────────────────────────

const CONCRETE_IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s+["'][^"']*providers\/(sms|email|push|courier|payment|events)\/[^"']*["']/m;
const SDK_IMPORT = /from\s+["'](resend|web-push)["']/;
/** 1+2: no runtime import of a concrete provider (or provider SDK) outside providers/**. */
export function concreteImportOffenders(sources: Source[]): string[] {
  return sources.filter((s) => !inProviders(s.path) && (CONCRETE_IMPORT.test(s.text) || SDK_IMPORT.test(s.text))).map((s) => s.path);
}

const SELECTION = /\benv\.providers\b|\b(SMS_PROVIDER|EMAIL_PROVIDER|COURIER_PROVIDER|PUSH_PROVIDER|PAYMENT_GATEWAYS)\b|\bresolveProviderSelection\(|\bbuildProviders\(/;
const SELECTION_OWNERS = ["apps/api/src/config/env.ts", "apps/api/src/providers/selection.ts", "apps/api/src/providers/registry.ts", "apps/api/src/providers/errors.ts"];
/** 1: provider selection happens only in the registry (env.ts declares the raw strings, selection.ts parses them). */
export function selectionOffenders(sources: Source[]): string[] {
  return sources.filter((s) => !SELECTION_OWNERS.includes(s.path) && SELECTION.test(s.text)).map((s) => s.path);
}

const GATEWAY_TERNARY = /===\s*["']EPS_PG["']\s*\?|initEpsSession\(|initSslcommerzSession\(|validateSslcommerzTransaction\(|verifyEpsTransaction\(/;
/** 3: one payment-gateway selection point (capabilities.gatewayIdForPaymentMethod + the registry). */
export function gatewaySelectionOffenders(sources: Source[]): string[] {
  return sources.filter((s) => !inProviders(s.path) && GATEWAY_TERNARY.test(s.text)).map((s) => s.path);
}

const CREDENTIAL_READ = /\benv\.(bulkSmsBd|resend|steadfast|sslcommerz|eps|webPush)\.(apiKey|senderId|secretKey|storeId|storePassword|username|password|hashKey|merchantId|publicKey|privateKey)\b|\benv\.meta\.accessToken\b/;
/** 4: provider credentials are read only by config/env.ts and providers/**. */
export function credentialReadOffenders(sources: Source[]): string[] {
  return sources.filter((s) => !inProviders(s.path) && s.path !== "apps/api/src/config/env.ts" && CREDENTIAL_READ.test(s.text)).map((s) => s.path);
}

const LOGGED_CREDENTIAL =
  /logger\.\w+\([^;]*\benv\.(bulkSmsBd|resend|steadfast|sslcommerz|eps|webPush|meta)(\s*[,)}]|\.(apiKey|senderId|secretKey|storeId|storePassword|username|password|hashKey|merchantId|privateKey|accessToken)\b)|logger\.\w+\([^;]*\b(params\.toString\(\)|BULKSMSBD_ENDPOINT)/;
/** 8: nothing logs a provider env block or a credential-bearing request URL. */
export function loggedCredentialOffenders(sources: Source[]): string[] {
  return sources.filter((s) => LOGGED_CREDENTIAL.test(s.text)).map((s) => s.path);
}

const WEB_ENV_ALLOWLIST = new Set([
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_CLARITY_ID",
  "NEXT_PUBLIC_META_PIXEL_ID",
  "NEXT_PUBLIC_TAWKTO_PROPERTY_ID",
  "NEXT_PUBLIC_TAWKTO_WIDGET_ID",
  "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "REVALIDATE_SECRET", // server-only route handler shared with the API (never NEXT_PUBLIC_, never in the bundle)
  "NODE_ENV",
]);
/** A secret-shaped variable exposed to the browser bundle. (Help text that merely *names* a server variable, e.g. the AI
 * page telling the owner to set ANTHROPIC_API_KEY on the API, is fine — only reads and NEXT_PUBLIC_ exposure leak.) */
const PUBLIC_SECRET = /\bNEXT_PUBLIC_[A-Z0-9_]*(SECRET|PRIVATE|PASSWORD|TOKEN|API_KEY|HASH_KEY)\b/;
/** 7: the web app reads only allow-listed env vars and never exposes a secret-shaped variable as NEXT_PUBLIC_. */
export function webSecretOffenders(sources: Source[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    for (const m of s.text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (!WEB_ENV_ALLOWLIST.has(m[1]!)) out.push(`${s.path}: process.env.${m[1]}`);
    if (PUBLIC_SECRET.test(s.text)) out.push(`${s.path}: secret-shaped NEXT_PUBLIC_ variable`);
  }
  return out;
}

/** No provider credential columns in the schema (only password/token *hashes*). */
export function schemaCredentialColumns(schema: string): string[] {
  return schema
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[a-z][A-Za-z0-9]*\s/.test(l))
    .map((l) => l.split(/\s+/)[0]!)
    .filter((field) => /apiKey|secretKey|accessToken|storePassword|privateKey|hashKey|^password$|^secret$/i.test(field) && !/Hash$/.test(field));
}

// ── Scans ──────────────────────────────────────────────────────────────────────────────────────

describe("provider boundary — guards", () => {
  const api = apiSources();

  it("no application/domain module imports a concrete provider or provider SDK (registry/capabilities/errors only)", () => {
    expect(concreteImportOffenders(api)).toEqual([]);
  });

  it("provider selection lives only in the registry (env.ts declares, selection.ts parses)", () => {
    expect(selectionOffenders(api)).toEqual([]);
  });

  it("one payment-gateway selection point — no inline EPS/SSLCommerz ternary or direct gateway call outside providers/", () => {
    expect(gatewaySelectionOffenders(api)).toEqual([]);
    const capabilities = code(join(API_SRC, "providers", "capabilities.ts"));
    expect(capabilities.match(/===\s*"EPS_PG"\s*\?/g)).toHaveLength(1);
  });

  it("provider credentials are read only in config/env.ts and providers/**", () => {
    expect(credentialReadOffenders(api)).toEqual([]);
  });

  it("no log call carries a provider env block or a credential-bearing URL", () => {
    expect(loggedCredentialOffenders(api)).toEqual([]);
    const sms = readFileSync(join(API_SRC, "providers", "sms", "bulksmsbd.ts"), "utf8");
    expect(sms).toMatch(/catch \(err\) \{\s*throw new SmsProviderError\(`\[sms\] BulkSMSBD request failed: \$\{maskText\(/);
  });

  it("the web app never reads or names a provider/server secret", () => {
    expect(webSecretOffenders(webSources())).toEqual([]);
  });

  it("the schema stores no provider credential", () => {
    expect(schemaCredentialColumns(readFileSync(join(ROOT, "apps", "api", "prisma", "schema.prisma"), "utf8"))).toEqual([]);
  });

  it("every outbound payment/push call added in W6 is bounded", () => {
    const ssl = code(join(API_SRC, "providers", "payment", "sslcommerz.ts"));
    expect(ssl.match(/\bawait fetch\(/g)).toHaveLength(2);
    expect(ssl.match(/signal: AbortSignal\.timeout\(SSLCOMMERZ_TIMEOUT_MS\)/g)).toHaveLength(2);
    const eps = code(join(API_SRC, "providers", "payment", "eps.ts"));
    expect(eps.match(/https\.request\(/g)).toHaveLength(1);
    expect(eps).toMatch(/req\.destroy\(err\);\s*\}, EPS_TIMEOUT_MS\)/);
    const push = code(join(API_SRC, "providers", "push", "web-push.ts"));
    expect(push).toMatch(/Promise\.race\(\[\s*webpush\.sendNotification\(/);
    expect(push).toMatch(/\}, PUSH_TIMEOUT_MS\)/);
  });
});

describe("provider boundary — the guards catch planted violations (mutation check)", () => {
  const at = (path: string, text: string): Source[] => [{ path, text }];

  it("concrete import / SDK import", () => {
    expect(concreteImportOffenders(at("apps/api/src/modules/x.ts", 'import { sendSms } from "../../providers/sms/bulksmsbd";'))).toHaveLength(1);
    expect(concreteImportOffenders(at("apps/api/src/modules/x.ts", 'import { Resend } from "resend";'))).toHaveLength(1);
    expect(concreteImportOffenders(at("apps/api/src/modules/x.ts", 'import type { SmsInput } from "../../providers/sms/bulksmsbd";'))).toHaveLength(0);
    expect(concreteImportOffenders(at("apps/api/src/modules/x.ts", 'import { getProviders } from "../../providers/registry";'))).toHaveLength(0);
  });

  it("selection outside the registry", () => {
    expect(selectionOffenders(at("apps/api/src/modules/x.ts", 'if (process.env.SMS_PROVIDER === "none") return;'))).toHaveLength(1);
    expect(selectionOffenders(at("apps/api/src/modules/x.ts", "const s = env.providers.sms;"))).toHaveLength(1);
  });

  it("duplicated gateway selection", () => {
    expect(gatewaySelectionOffenders(at("apps/api/src/modules/payments/payment.service.ts", 'order.paymentMethod === "EPS_PG" ? a : b'))).toHaveLength(1);
    expect(gatewaySelectionOffenders(at("apps/api/src/modules/payments/payment.controller.ts", "await verifyEpsTransaction(ref)"))).toHaveLength(1);
  });

  it("credential read / logged credential / web secret / schema column", () => {
    expect(credentialReadOffenders(at("apps/api/src/modules/x.ts", "const k = env.bulkSmsBd.apiKey;"))).toHaveLength(1);
    expect(loggedCredentialOffenders(at("apps/api/src/providers/sms/bulksmsbd.ts", 'logger.info("url", { u: params.toString() });'))).toHaveLength(1);
    expect(loggedCredentialOffenders(at("apps/api/src/x.ts", "logger.error('x', { cfg: env.steadfast });"))).toHaveLength(1);
    expect(loggedCredentialOffenders(at("apps/api/src/x.ts", "logger.error(`k=${env.resend.apiKey}`);"))).toHaveLength(1);
    expect(loggedCredentialOffenders(at("apps/api/src/x.ts", 'logger.info(`sent${env.meta.testEventCode ? " (test)" : ""}`);'))).toHaveLength(0);
    expect(webSecretOffenders(at("apps/web/lib/x.ts", "const k = process.env.STEADFAST_API_KEY;"))).toHaveLength(1);
    expect(webSecretOffenders(at("apps/web/lib/x.ts", "const k = process.env.NEXT_PUBLIC_META_ACCESS_TOKEN;"))).toHaveLength(2);
    expect(webSecretOffenders(at("apps/web/app/x.tsx", "<code>ANTHROPIC_API_KEY</code> on the API server"))).toHaveLength(0);
    expect(webSecretOffenders(at("apps/web/lib/x.ts", "const u = process.env.NEXT_PUBLIC_SITE_URL;"))).toHaveLength(0);
    expect(schemaCredentialColumns("model X {\n  smsApiKey String?\n  passwordHash String\n}")).toEqual(["smsApiKey"]);
  });
});
