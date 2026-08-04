"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

const QUERY_KEY = ["current-customer"];

/** For pages that require a logged-in customer (the /account shell) — redirects to login on 401. */
export function useCurrentCustomer() {
  const router = useRouter();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getCurrentCustomer, retry: false });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) {
      router.replace("/account/login");
    }
  }, [query.error, router]);

  return query;
}

/** For guest-allowed pages (checkout) — same session query, but never redirects; a 401 just means "not logged in". */
export function useOptionalCustomer() {
  return useQuery({ queryKey: QUERY_KEY, queryFn: getCurrentCustomer, retry: false });
}
