import Link from "next/link";
import { RecentlyViewedCarousel } from "@/components/storefront/recently-viewed-carousel";
import { AccountPageHeader } from "@/components/account/account-page-header";

export default function AccountBrowsingHistoryPage() {
  return (
    <div>
      <AccountPageHeader title="Browsing History" description="Products you've recently looked at." />
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
