"use client";

import { ListPage } from "@/components/admin/patterns/list-page";
import { ScanStation } from "@/components/admin/parcel-scans/scan-station";
import { useCapabilities } from "@/hooks/use-capability";
import { EmptyState } from "@/components/ui/empty-state";
import { ScanLine } from "lucide-react";

/** Dispatch scan (Order Operations phase 4) — a USB scanner or the camera; see components/admin/parcel-scans/scan-station.tsx. */
export default function Page() {
  const { can, ready } = useCapabilities();
  return (
    <ListPage title="Dispatch scan" descriptionOnPhone description="Scan each parcel as the courier collects it. A scan records the handover only — never stock, payment or the order's status.">
      {ready && !can("parcels.scan") ? (
        <EmptyState icon={ScanLine} title="Scanning isn't on your account" description="Ask an owner to give you parcel scanning." />
      ) : (
        <ScanStation kind="DISPATCH" />
      )}
    </ListPage>
  );
}
