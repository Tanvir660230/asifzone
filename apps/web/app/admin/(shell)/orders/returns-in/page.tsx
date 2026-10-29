"use client";

import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { ScanStation } from "@/components/admin/parcel-scans/scan-station";
import { useCapabilities } from "@/hooks/use-capability";
import { EmptyState } from "@/components/ui/empty-state";
import { ScanLine } from "lucide-react";

/** Returns in (Order Operations phase 4) — a USB scanner or the camera; see components/admin/parcel-scans/scan-station.tsx. */
export default function Page() {
  const { can, ready } = useCapabilities();
  return (
    <div>
      <PageHeader title="Returns in" descriptionOnPhone description="Scan each parcel that comes back. It is marked as physically received; stock returns only when it is inspected on the order." />
      <ModuleTabs />
      {ready && !can("parcels.scan") ? (
        <EmptyState icon={ScanLine} title="Scanning isn't on your account" description="Ask an owner to give you parcel scanning." />
      ) : (
        <ScanStation kind="RETURN" />
      )}
    </div>
  );
}
