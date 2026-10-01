/**
 * Structured logger (Phase 11, BD-11.4; contract §6.2). One JSON object per line on stdout:
 *   { ts, level, msg, correlationId, operation, ...fields }
 *
 * Redaction runs before anything is serialised: credential-like keys become "[redacted]" and phone numbers / emails are
 * masked wherever they appear in string values. Never log request bodies; pass the few fields that matter.
 */
import { AppError } from "../app-error";
import { currentContext } from "./context";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type ErrorClass = "app_error" | "provider_timeout" | "provider_rejected" | "db" | "unexpected";

const SECRET_KEY = /pass(word|code)?|otp|^code$|token|secret|authorization|cookie|api[-_]?key|secretkey|hashkey|signature|credential/i;
const PHONE = /(?<!\d)(?:\+?88)?(01\d)(\d{6})(\d{2})(?!\d)/g;
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9])[A-Za-z0-9.-]*\.([A-Za-z]{2,})/g;
// A JWT or a long opaque hex token appearing inside free text (e.g. an error message echoing a URL).
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const LONG_HEX = /\b[a-f0-9]{48,}\b/gi;

export function maskText(value: string): string {
  return value
    .replace(JWT, "[redacted-jwt]")
    .replace(LONG_HEX, "[redacted-token]")
    .replace(PHONE, (_m, a: string, _b: string, c: string) => `${a}******${c}`)
    .replace(EMAIL, (_m, first: string, domainFirst: string, tld: string) => `${first}***@${domainFirst}***.${tld}`);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return maskText(value);
  if (value instanceof Error) return { name: value.name, message: maskText(value.message) };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

export function classifyError(err: unknown): ErrorClass {
  if (err instanceof AppError) return err.statusCode >= 500 && (err as { outcomeUnknown?: boolean }).outcomeUnknown ? "provider_timeout" : "app_error";
  const name = (err as { name?: string })?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError") return "provider_timeout";
  if (name.startsWith("PrismaClient")) return "db";
  if (/provider|LiveProviderBlocked|MailProviderError/i.test(name)) return "provider_rejected";
  return "unexpected";
}

type Sink = (line: string) => void;
let sink: Sink = (line) => process.stdout.write(`${line}\n`);
const minLevel: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = minLevel[(process.env.LOG_LEVEL as LogLevel) ?? (process.env.NODE_ENV === "test" ? "warn" : "info")] ?? 20;

/** Tests capture output here instead of stdout. */
export function setLogSink(next: Sink | null) {
  sink = next ?? ((line) => process.stdout.write(`${line}\n`));
}

function write(level: LogLevel, msg: string, fields?: Record<string, unknown>, force = false) {
  if (!force && minLevel[level] < threshold) return;
  const ctx = currentContext();
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: maskText(msg),
    correlationId: ctx?.correlationId ?? null,
    operation: ctx?.operation ?? null,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  sink(JSON.stringify(entry));
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
  /** For tests of the logger itself: emit regardless of LOG_LEVEL. */
  _force: (level: LogLevel, msg: string, fields?: Record<string, unknown>) => write(level, msg, fields, true),
};
