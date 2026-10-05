import type { ComponentProps } from "react";
import { PageHeader } from "@/components/ui/page-header";

/** Heading for /account subpages — the shared PageHeader at its sub-page size. */
export function AccountPageHeader(props: Omit<ComponentProps<typeof PageHeader>, "size">) {
  return <PageHeader size="md" {...props} />;
}
