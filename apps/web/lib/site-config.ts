// Single place to swap in the real brand name/tagline/social handles once decided.
export const siteConfig = {
  name: "Asif Zone",
  tagline: "Considered clothing, made to last",
  // Leave a handle null until the client supplies the real profile — the footer only renders icons for set values.
  social: {
    facebook: null as string | null,
    instagram: null as string | null,
    whatsapp: null as string | null,
  },
  // Leave null until the client supplies real contact details — pages fall back to "coming soon" copy.
  contactEmail: null as string | null,
  contactPhone: null as string | null,
};
