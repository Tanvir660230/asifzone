"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/** Renders its (server-rendered) children everywhere except under the given path prefixes. */
export function HiddenOnRoutes({ prefixes, children }: { prefixes: string[]; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  if (prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return <>{children}</>;
}
