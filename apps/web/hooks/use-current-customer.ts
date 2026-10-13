"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";
import { pixelIdentify } from "@/lib/pixels";
import type { Customer } from "@clothing-brand/shared";

const QUERY_KEY = ["current-customer"];

/** The signed-in customer's own contact details go to the ad pixels' advanced matching (lib/pixels/ — memory only, and
 * only sent with an event the shopper consented to). Every storefront page that already loads the session reports it,
 * so no page fetches the customer just for this. */
function useIdentifyForPixels(customer: Customer | undefined) {
  useEffect(() => {
    if (customer) pixelIdentify({ email: customer.email, phone: customer.phone, fullName: customer.name });
  }, [customer]);
}

/** For pages that require a logged-in customer (the /account shell) — redirects to login on 401. */
export function useCurrentCustomer() {
  const router = useRouter();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getCurrentCustomer, retry: false });
  useIdentifyForPixels(query.data?.customer);

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) {
      router.replace("/account/login");
    }
  }, [query.error, router]);

  return query;
}

/** For guest-allowed pages (checkout) — same session query, but never redirects; a 401 just means "not logged in". */
export function useOptionalCustomer() {
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getCurrentCustomer, retry: false });
  useIdentifyForPixels(query.data?.customer);
  return query;
}
