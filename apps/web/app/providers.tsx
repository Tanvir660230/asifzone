"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { ClientErrorListener } from "@/components/system/client-error-listener";
import { WebVitalsReporter } from "@/components/analytics/web-vitals-reporter";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );

  // reducedMotion="user": every Framer Motion animation follows the OS "reduce motion" setting (the
  // CSS side does the same in globals.css), so no component has to check it individually.
  return (
    <QueryClientProvider client={queryClient}>
      <ClientErrorListener />
      <WebVitalsReporter />
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </QueryClientProvider>
  );
}
