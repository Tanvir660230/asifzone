import { RecentlyViewedCarousel } from "@/components/storefront/recently-viewed-carousel";

export default function AccountBrowsingHistoryPage() {
  return (
    <div>
      <h1 className="mb-6 font-display text-2xl text-ink-900">Browsing History</h1>
      <RecentlyViewedCarousel title="Recently Viewed" />
    </div>
  );
}
