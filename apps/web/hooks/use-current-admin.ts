"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getCurrentAdmin } from "@/lib/auth";
import { ApiError } from "@/lib/api-client";

/** Verifies the access-token cookie actually holds a valid, non-expired admin session (the edge middleware only checks the cookie is present). Redirects to login if verification fails. */
export function useCurrentAdmin() {
  const router = useRouter();
  const query = useQuery({
    queryKey: ["current-admin"],
    queryFn: getCurrentAdmin,
    retry: false,
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) {
      router.replace("/admin/login");
    }
  }, [query.error, router]);

  return query;
}
