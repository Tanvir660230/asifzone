import type { ReactNode } from "react";

// A sibling of admin/(shell), like admin/(invoice): the product wizard embeds this page in an iframe as its live
// preview, so it must render just the storefront view — no admin header/sidebar, and no storefront shell either (that
// would load the live-chat widget and other shopper-facing extras inside the admin). Still under /admin, so the
// middleware's admin-session check and the admin layout's noindex apply.
export const dynamic = "force-dynamic";

export default function AdminPreviewFrameLayout({ children }: { children: ReactNode }) {
  return children;
}
