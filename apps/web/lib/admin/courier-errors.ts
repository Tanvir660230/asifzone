/**
 * Centralized human-readable formatter for courier sync / booking provider errors.
 * Turns raw HTTP/provider error strings (Steadfast timeouts, 5xx, auth, invalid phone/address) into plain, actionable
 * guidance for staff, while keeping the raw string available behind a collapsible detail if support needs it.
 */
export interface FormattedCourierError {
  summary: string;
  action: string;
  raw: string;
}

export function formatCourierError(raw: string): FormattedCourierError {
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (/timeout|timed out|etimedout|econnreset|econnrefused|network|fetch failed|502|503|504/i.test(lower)) {
    return {
      summary: "Couldn't reach the courier right now",
      action: "Wait a couple of minutes and press Sync again.",
      raw: text,
    };
  }
  if (/401|403|unauthorized|unauthenticated|api.?key|secret|credential/i.test(lower)) {
    return {
      summary: "Courier login credentials were rejected",
      action: "Check the courier API key and secret in Settings → Integrations.",
      raw: text,
    };
  }
  if (/429|rate.?limit|too many/i.test(lower)) {
    return {
      summary: "Courier rate limit reached",
      action: "Too many syncs at once — try again in a minute.",
      raw: text,
    };
  }
  if (/phone|mobile|recipient_phone|invalid number/i.test(lower)) {
    return {
      summary: "The courier rejected the customer's phone number",
      action: "Check that it is a valid 11-digit BD mobile number, then retry.",
      raw: text,
    };
  }
  if (/address|recipient_address|district|zone/i.test(lower)) {
    return {
      summary: "The courier couldn't accept the delivery address",
      action: "Review the address and district, then try booking again.",
      raw: text,
    };
  }
  if (/404|not found|consignment|tracking/i.test(lower)) {
    return {
      summary: "The courier couldn't find this consignment",
      action: "Verify the tracking / consignment ID on the courier portal.",
      raw: text,
    };
  }
  if (/500|internal server/i.test(lower)) {
    return {
      summary: "The courier service returned a temporary server error",
      action: "Try syncing again in a few minutes.",
      raw: text,
    };
  }

  return {
    summary: "Courier sync failed",
    action: "Check the parcel on the courier portal or try syncing again.",
    raw: text,
  };
}
