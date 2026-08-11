const BRAND_NAME = "ASIF ZONE";
const BRAND_TAGLINE = "Premium clothing, delivered fast.";
const FONT = "Arial, Helvetica, sans-serif";

interface EmailLayoutOptions {
  /** Pre-built HTML for the message body — headings/paragraphs/lists the caller composes. */
  bodyHtml: string;
  /** Optional single primary action, rendered as a solid black pill button instead of a raw link
   * — every call site used to paste the bare URL as its own link text. */
  ctaLabel?: string;
  ctaUrl?: string;
  /** Extra line rendered below the tagline in the footer — used for the one-click unsubscribe
   * link on marketing sends. Left unset, transactional emails (order confirmation, password
   * reset, ...) get no unsubscribe link, since those aren't marketing and can't be opted out of. */
  footerHtml?: string;
}

/** Wraps body HTML in a branded, table-based layout — the one place that owns visual consistency
 * across every transactional/marketing email `sendMail` sends. Inline styles only and a table
 * layout throughout: email clients strip `<style>` blocks and don't support modern CSS (flexbox,
 * grid, external stylesheets), so this is intentionally written like it's still 2005. */
export function renderEmailLayout({ bodyHtml, ctaLabel, ctaUrl, footerHtml }: EmailLayoutOptions): string {
  const cta =
    ctaLabel && ctaUrl
      ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px;">
        <tr>
          <td style="background-color:#111111;border-radius:999px;">
            <a href="${ctaUrl}" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:999px;font-family:${FONT};">${ctaLabel}</a>
          </td>
        </tr>
      </table>`
      : "";

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f8f8f8;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f8f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;border:1px solid #ececec;overflow:hidden;">
            <tr>
              <td style="background-color:#111111;padding:22px 32px;text-align:center;">
                <span style="color:#ffffff;font-size:19px;font-weight:700;letter-spacing:2px;font-family:${FONT};">${BRAND_NAME}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 8px;font-family:${FONT};font-size:14px;line-height:1.65;color:#111111;">
                ${bodyHtml}
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;background-color:#f8f8f8;border-top:1px solid #ececec;text-align:center;">
                <p style="margin:0;font-size:12px;color:#666666;font-family:${FONT};">${BRAND_TAGLINE}</p>
                <p style="margin:8px 0 0;font-size:11px;color:#999999;font-family:${FONT};">&copy; ${new Date().getFullYear()} Asif Zone. All rights reserved.</p>
                ${footerHtml ? `<p style="margin:8px 0 0;font-size:11px;color:#999999;font-family:${FONT};">${footerHtml}</p>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** A link rendered inline within body copy (not the primary CTA) — plain `<a>` tags default to
 * client blue/underline regardless of surrounding color, so every in-body link needs this. */
export function emailLink(url: string, label: string): string {
  return `<a href="${url}" style="color:#111111;text-decoration:underline;">${label}</a>`;
}
