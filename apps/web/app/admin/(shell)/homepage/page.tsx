"use client";

import { StudioShell } from "@/components/admin/studio/studio-shell";

/** Admin → Storefront → Homepage: the Storefront Studio, full screen over the console. Phones edit too (owner,
 * 2026-10-12, superseding DR-25's view-only) — below 768px the Studio switches to its phone layout. */
export default function HomepageStudioPage() {
  return (
    <div className="fixed inset-0 z-dock" data-surface="admin">
      <StudioShell />
    </div>
  );
}
