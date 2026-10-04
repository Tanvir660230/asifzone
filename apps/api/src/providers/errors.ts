import { AppError } from "../lib/app-error";

/**
 * Provider error vocabulary (Phase 12 W2). Moved verbatim from the provider modules so that application code (outbox
 * processor, courier service, logger classification) can recognise them without importing a concrete provider.
 * `retryable` is read by domain/outbox/processor.ts.
 */

/** A failed send. `retryable` separates "try again later" (network, timeout, HTTP 5xx/429) from the provider actively
 * rejecting the message (invalid number, bad sender id, credentials) — which no retry will fix (Phase 8 retry policy). */
export class SmsProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SmsProviderError";
  }
}

/** A failed send; `retryable` is false when the provider rejected the request itself (validation, domain, credentials). */
export class MailProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MailProviderError";
  }
}

/** Thrown for a failed send. `retryable` separates "try again later" (network, timeout, 5xx, 429,
 * Meta's own is_transient flag) from a payload/credential problem that no retry will ever fix. */
export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** A booking whose result we can't know: the request timed out, the connection dropped, or Steadfast answered 5xx —
 * it may or may not have created the consignment. The caller keeps its booking claim (no automatic re-booking) and the
 * order is flagged for an operator to check Steadfast before retrying (Phase 9 D-4). */
export class CourierOutcomeUnknownError extends AppError {
  readonly outcomeUnknown = true;
  constructor(message: string) {
    super(502, message, { code: "COURIER_OUTCOME_UNKNOWN" });
    this.name = "CourierOutcomeUnknownError";
  }
}

/** A capability was used while its provider is explicitly disabled (`SMS_PROVIDER=none`, `COURIER_PROVIDER=none`, a
 * gateway missing from `PAYMENT_GATEWAYS`, …). Never retryable, never a fake success: the caller sees a clear 400. */
export class ProviderNotConfiguredError extends AppError {
  readonly retryable = false;
  constructor(
    readonly capability: string,
    readonly envVar: string,
  ) {
    super(400, `${capability} is not configured for this store (${envVar})`, { code: "PROVIDER_NOT_CONFIGURED", capability });
    this.name = "ProviderNotConfiguredError";
  }
}

/** Startup configuration problem. The message names environment variables only — never a value. */
export class ProviderConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Provider configuration invalid:\n- ${problems.join("\n- ")}`);
    this.name = "ProviderConfigError";
  }
}
