"use client";

import type { ReactNode } from "react";
import type { Capability } from "@/lib/admin/capabilities";
import { useCapability } from "@/hooks/use-capability";

/**
 * Renders its children only when this admin has the capability (Blueprint V2 P0) — for UI that is purely "shown if
 * allowed". When the same check also drives logic (enabling a query, choosing a default), call useCapability instead.
 * UX only: the API enforces every permission itself.
 */
export function PermissionGate({ capability, children, fallback = null }: { capability: Capability; children: ReactNode; fallback?: ReactNode }) {
  return <>{useCapability(capability) ? children : fallback}</>;
}
