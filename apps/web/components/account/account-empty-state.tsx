import type { ComponentProps } from "react";
import { EmptyState } from "@/components/ui/empty-state";

/** Empty state for /account list pages — the shared EmptyState in its standalone (bordered) form. */
export function AccountEmptyState(props: Omit<ComponentProps<typeof EmptyState>, "variant">) {
  return <EmptyState variant="bordered" {...props} />;
}
