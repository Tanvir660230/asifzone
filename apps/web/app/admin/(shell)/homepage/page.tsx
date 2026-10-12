"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/admin/page-header";
import { Outline } from "@/components/admin/studio/outline";
import { StudioShell } from "@/components/admin/studio/studio-shell";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getStudio } from "@/lib/api/admin-homepage-studio";

/** Admin → Storefront → Homepage: the Storefront Studio, full screen over the console. */
export default function HomepageStudioPage() {
  // DR-25: designing the page needs the width — on phones the homepage is view-only (its sections, in order).
  const phone = useMediaQuery("(max-width: 767px)");
  if (phone) return <PhoneView />;
  return (
    <div className="fixed inset-0 z-dock" data-surface="admin">
      <StudioShell />
    </div>
  );
}

function PhoneView() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["studio-phone-view"], queryFn: getStudio });
  return (
    <div>
      <PageHeader title="Homepage" description="Designing the homepage needs a wider screen — open it on a tablet or computer. Here you can see what's on the page, in order." />
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      )}
      {isError && <ErrorState title="Couldn't load the homepage" onRetry={() => void refetch()} />}
      {data && (
        <Outline
          readOnly
          sections={data.sections}
          selectedId={null}
          checks={[]}
          emptyIds={new Set()}
          deviceLabel="phones"
          onSelect={() => {}}
          onMove={() => {}}
          onToggle={() => {}}
          onAdd={() => {}}
        />
      )}
    </div>
  );
}
