import { afterEach, describe, expect, it, vi } from "vitest";
import { CREDENTIAL_PARAM, logger, maskText, redact } from "../lib/observability/logger";
import { captureError } from "../lib/observability/error-capture";

// Phase 12 W7 (contract S-6): BulkSMSBD takes its API key in the query string and SSLCommerz's validator takes
// store_passwd there too. Wherever such a URL ends up in free text, the credential is masked before it is logged.

const KEY = "SENTINEL-bulksms-KEY-4c1d";
const PASS = "SENTINEL-ssl-PASS-88aa";
const smsUrl = `https://bulksmsbd.net/api/smsapi?api_key=${KEY}&type=text&number=8801700000000&senderid=X&message=hi`;
const sslUrl = `https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php?val_id=V1&store_id=S&store_passwd=${PASS}&format=json`;

afterEach(() => vi.restoreAllMocks());

function captureStdout(): { lines: () => string } {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  return { lines: () => chunks.join("") };
}

describe("credential query parameters are masked", () => {
  it("maskText removes api_key / store_passwd / token / password values and keeps the rest of the URL readable", () => {
    expect(maskText(smsUrl)).not.toContain(KEY);
    expect(maskText(smsUrl)).toContain("api_key=[redacted]&type=text");
    expect(maskText(sslUrl)).not.toContain(PASS);
    expect(maskText(sslUrl)).toContain("val_id=V1&store_id=S&store_passwd=[redacted]&format=json");
    expect(maskText("x?access_token=abc.def&y=1")).toBe("x?access_token=[redacted]&y=1");
    expect(maskText("x?password=hunter2")).toBe("x?password=[redacted]");
    expect(maskText("?apikey=Q&key=W&secret_key=E")).toBe("?apikey=[redacted]&key=[redacted]&secret_key=[redacted]");
  });

  it("the pattern does not touch ordinary parameters", () => {
    CREDENTIAL_PARAM.lastIndex = 0;
    expect(maskText("https://x.example/p?page=2&sort=asc&monkey=1")).toBe("https://x.example/p?page=2&sort=asc&monkey=1");
  });

  it("an Error whose message embeds the URL is redacted by redact()", () => {
    const out = redact(new Error(`fetch failed for ${smsUrl}`)) as { message: string };
    expect(out.message).not.toContain(KEY);
  });

  it("a logged error line and a captured exception never contain the key", () => {
    const out = captureStdout();
    logger.error("[sms] provider failure", { detail: `GET ${smsUrl}` });
    captureError(new Error(`request to ${smsUrl} failed`), { msg: "[sms] send failed:" });
    const text = out.lines();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain(KEY);
    expect(text).toContain("api_key=[redacted]");
  });
});
