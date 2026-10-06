import { DISPLAY_LOCALE, type StoreSettings } from "@clothing-brand/shared";

/**
 * Presentation helpers for the store's identity (Phase 12 W9). The values themselves are owned by StoreSetting
 * (settings.service / getSettings); these only format them. Nothing here hard-codes a store, a city or a country:
 * a field the store hasn't set renders as absent.
 */

type IdentityFields = Pick<
  StoreSettings,
  "storeName" | "legalName" | "addressLine" | "addressCity" | "addressRegion" | "addressPostalCode" | "addressCountry" | "legalJurisdiction"
>;

/** "BD" → "Bangladesh" in the display locale; the code itself if the runtime can't name it. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([DISPLAY_LOCALE], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The short "City, Country" line (footer, contact card) — null when neither is set. */
export function shortAddress(s: IdentityFields): string | null {
  const parts = [s.addressCity, countryName(s.addressCountry)].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length ? parts.join(", ") : null;
}

/** The full postal address as display lines — empty when nothing is set. */
export function fullAddressLines(s: IdentityFields): string[] {
  const cityLine = [s.addressCity, s.addressRegion, s.addressPostalCode].filter((p) => p && p.trim()).join(", ");
  return [s.addressLine, cityLine, countryName(s.addressCountry)].filter((p): p is string => Boolean(p && p.trim()));
}

/** The name contracts and legal text use: the registered legal name, else the store name. */
export function legalEntityName(s: IdentityFields): string {
  return s.legalName?.trim() || s.storeName;
}

/** The governing-law sentence on the Terms page. */
export function governingLawSentence(s: IdentityFields): string {
  return s.legalJurisdiction?.trim()
    ? `These terms are governed by the laws of ${s.legalJurisdiction.trim()}.`
    : `These terms are governed by the laws of the country in which ${legalEntityName(s)} is registered.`;
}

/** schema.org PostalAddress for the Organization JSON-LD — undefined when no address field is set. */
export function postalAddressJsonLd(s: IdentityFields) {
  const address = {
    ...(s.addressLine ? { streetAddress: s.addressLine } : {}),
    ...(s.addressCity ? { addressLocality: s.addressCity } : {}),
    ...(s.addressRegion ? { addressRegion: s.addressRegion } : {}),
    ...(s.addressPostalCode ? { postalCode: s.addressPostalCode } : {}),
    ...(s.addressCountry ? { addressCountry: s.addressCountry } : {}),
  };
  return Object.keys(address).length ? { "@type": "PostalAddress", ...address } : undefined;
}
