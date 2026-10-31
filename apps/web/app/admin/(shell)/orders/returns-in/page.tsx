"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { ScanStation } from "@/components/admin/parcel-scans/scan-station";
import { ReceiveStation } from "@/components/admin/parcel-scans/receive-station";
import { useCapabilities } from "@/hooks/use-capability";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/tabs";
import { ScanLine } from "lucide-react";

/**
 * Returns in — the scanner's return mode. "Receive and inspect" (returns.manage) takes one parcel at a time from scan to
 * confirmed receipt, with no return request needed (components/admin/parcel-scans/receive-station.tsx). "Quick receipt"
 * is the batch scan for a busy day: it only records that parcels are physically back; they are inspected later.
 */
export default function Page() {
  const { can, ready } = useCapabilities();
  const params = useSearchParams();
  const router = useRouter();
  const canInspect = can("returns.manage");
  const view = params.get("view") === "batch" || (ready && !canInspect) ? "batch" : "inspect";
  return (
    <div>
      <PageHeader
        title="Returns in"
        descriptionOnPhone
        description="Scan a parcel that came back, say what is in it and confirm. Only what is physically in hand goes back into stock."
      />
      <ModuleTabs />
      {ready && !can("parcels.scan") ? (
        <EmptyState icon={ScanLine} title="Scanning isn't on your account" description="Ask an owner to give you parcel scanning." />
      ) : (
        <>
          {canInspect && (
            <SegmentedControl
              className="mt-4"
              aria-label="How to receive"
              value={view}
              onChange={(v) => router.replace(v === "batch" ? "/admin/orders/returns-in?view=batch" : "/admin/orders/returns-in")}
              options={[
                { value: "inspect", label: "Receive and inspect", testId: "returns-view-inspect" },
                { value: "batch", label: "Quick receipt (batch)", testId: "returns-view-batch" },
              ]}
            />
          )}
          {ready && !canInspect && <p className="mt-3 text-xs text-fg-muted">Inspecting a parcel (the step that restocks) needs the Returns permission — scans here record the receipt only.</p>}
          {view === "inspect" ? <ReceiveStation /> : <ScanStation kind="RETURN" />}
        </>
      )}
    </div>
  );
}
