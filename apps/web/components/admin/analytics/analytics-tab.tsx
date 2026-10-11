"use client";

import { Suspense, type ComponentType } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { SegmentedControl } from "@/components/ui/tabs";

export interface AnalyticsView {
  value: string;
  label: string;
  /** A React.lazy component — each view's code loads only when it is opened. */
  Component: ComponentType;
}

interface AnalyticsTabProps {
  title: string;
  description: string;
  views: readonly AnalyticsView[];
}

function AnalyticsTabInner({ title, description, views }: AnalyticsTabProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = views.find((v) => v.value === searchParams.get("view")) ?? views[0]!;

  // The default view keeps a clean URL; another view is ?view=<value> (shareable, back-button friendly).
  function setView(value: string) {
    const query = new URLSearchParams(searchParams.toString());
    if (value === views[0]!.value) query.delete("view");
    else query.set("view", value);
    const qs = query.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const View = current.Component;
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} className="mb-0" />
      {views.length > 1 && (
        <SegmentedControl aria-label={`${title} views`} size="md" value={current.value} onChange={setView} options={views.map((v) => ({ value: v.value, label: v.label }))} />
      )}
      {/* React.lazy, not next/dynamic: next/dynamic adds a <link rel=preload> without the CSP nonce, which the strict
          policy blocks (a console error, and no preload); lazy chunks load through webpack's runtime under 'strict-dynamic'. */}
      <Suspense fallback={<AnalyticsViewSkeleton />}>
        <View />
      </Suspense>
    </div>
  );
}

/** One Analytics tab: the page title, its views as a segmented control (URL ?view=), and the chosen view. */
export function AnalyticsTab(props: AnalyticsTabProps) {
  return (
    <Suspense fallback={<AnalyticsViewSkeleton />}>
      <AnalyticsTabInner {...props} />
    </Suspense>
  );
}

/** Shown while a view's code loads. */
export function AnalyticsViewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-48 animate-pulse rounded-md bg-ink-900/[0.06]" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-ink-900/[0.04]" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-xl bg-ink-900/[0.04]" />
    </div>
  );
}
