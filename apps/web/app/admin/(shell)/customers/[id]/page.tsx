"use client";

import { useParams, useRouter } from "next/navigation";
import { CustomerDetailPanel } from "@/components/admin/customer-detail-panel";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  return <CustomerDetailPanel customerId={id} onClose={() => router.push("/admin/customers")} variant="page" />;
}
