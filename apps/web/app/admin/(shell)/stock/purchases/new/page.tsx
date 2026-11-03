"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PackagePlus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/empty-state";
import { PermissionState } from "@/components/admin/permission-state";
import { BoughtSheet } from "@/components/admin/stock/bought-sheet";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as stockApi from "@/lib/api/stock";

/**
 * Stock › Purchases › New purchase (stock UI redesign): the purchase form as a page — one item or a whole bill, in stock
 * units or the units the supplier sells in, arrived now or ordered. Same API and rules as the quick sheet on Stock; the
 * half-typed purchase is kept on this device as a draft.
 */
export default function NewPurchasePage() {
  const router = useRouter();
  const { can, ready } = useCapabilities();
  const allowed = can("purchasing.receive");
  const overview = useQuery({ queryKey: stockApi.stockKeys.overview(), queryFn: stockApi.getStockOverview, enabled: allowed });
  const purchases = useQuery({ queryKey: stockApi.stockKeys.purchases(), queryFn: () => stockApi.listStockPurchases(20), enabled: allowed && can("purchasing.view") });
  if (ready && !allowed) return <PermissionState icon={PackagePlus} page="New purchase" />;
  if (overview.isError) return <ErrorState title="The purchase form couldn't load" description={getErrorMessage(overview.error, "Check your connection and try again.")} onRetry={() => overview.refetch()} variant="bordered" />;
  if (!overview.data) return <div className="space-y-4" aria-busy="true" aria-label="Loading"><Skeleton className="h-8 w-56" /><Skeleton className="h-64 w-full max-w-4xl rounded-xl" /></div>;
  return (
    <BoughtSheet
      asPage
      overview={overview.data}
      purchases={purchases.data?.purchases ?? []}
      canOwnerMoney={can("finance.sensitive")}
      canEditCatalog={can("catalog.manage")}
      canOrder={can("purchasing.manage")}
      onClose={() => router.push("/admin/stock/purchases")}
    />
  );
}
