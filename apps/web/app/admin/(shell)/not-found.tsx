import Link from "next/link";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";

/** An address under /admin that isn't a page (an old bookmark, a typo): said inside the console, with the way back —
 * not the storefront's 404 with its shop menu. */
export default function AdminNotFound() {
  return (
    <div className="py-16">
      <EmptyState
        icon={Compass}
        title="This page isn't here"
        description="It may have moved in the new menu. Use the search at the top, or go back to where the work is."
        testId="admin-not-found"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/admin/dashboard" className={buttonVariants({})}>
              Dashboard
            </Link>
            <Link href="/admin/orders" className={buttonVariants({ variant: "outline" })}>
              Orders
            </Link>
          </div>
        }
      />
    </div>
  );
}
