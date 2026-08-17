import Link from "next/link";
import { RecentlyViewedCarousel } from "@/components/storefront/recently-viewed-carousel";

export default function AccountBrowsingHistoryPage() {
  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-ink-900">Browsing History</h1>
      <RecentlyViewedCarousel
        title="Recently Viewed"
        emptyState={
          <p className="text-ink-400">
            You haven&rsquo;t viewed any products yet —{" "}
            <Link href="/search" className="text-brass-600 underline hover:text-brass-500">
              browse the collection
            </Link>
            .
          </p>
        }
      />
    </div>
  );
}
