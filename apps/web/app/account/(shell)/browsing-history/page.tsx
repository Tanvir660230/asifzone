import Link from "next/link";
import { History } from "lucide-react";
import { RecentlyViewedCarousel } from "@/components/storefront/recently-viewed-carousel";
import { AccountTitle } from "@/components/account/account-ui";
import { AccountEmptyState } from "@/components/account/account-empty-state";
import { buttonVariants } from "@/components/ui/button";

export default function AccountBrowsingHistoryPage() {
  return (
    <div>
      <AccountTitle title="Recently viewed" description="Products you've looked at on this device." />
      <RecentlyViewedCarousel
        title="Recently viewed"
        emptyState={
          <AccountEmptyState
            icon={History}
            title="Nothing viewed yet"
            description="Products you open will appear here so you can find them again."
            action={
              <Link href="/search" className={buttonVariants({ size: "sm", variant: "outline" })}>
                Browse the collection
              </Link>
            }
          />
        }
      />
    </div>
  );
}
