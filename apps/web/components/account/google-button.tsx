"use client";

import { useEffect, useRef } from "react";
import type { Customer } from "@clothing-brand/shared";
import { env } from "@/lib/env";
import { loginWithGoogle } from "@/lib/customer-auth";
import { ApiError } from "@/lib/api-client";

const SCRIPT_ID = "google-identity-services";

interface GoogleCredentialResponse {
  credential: string;
}

/** Loads Google Identity Services directly (no @react-oauth/google dependency — this is the only
 * thing we need it for) and owns the sign-in API call itself, so both the login and register pages
 * can drop this in without duplicating fetch/error handling. Renders nothing at all when
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID isn't set, same "quietly absent until configured" pattern as the AI
 * features when ANTHROPIC_API_KEY is unset. */
export function GoogleButton({
  onSuccess,
  onError,
}: {
  onSuccess: (customer: Customer) => void;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!env.googleClientId) return;

    async function handleCredential(response: GoogleCredentialResponse) {
      try {
        const { customer } = await loginWithGoogle({ idToken: response.credential });
        onSuccess(customer);
      } catch (err) {
        onError(err instanceof ApiError ? err.message : "Google sign-in failed, please try again");
      }
    }

    function render() {
      const google = (window as unknown as { google?: any }).google;
      if (!google || !containerRef.current) return;

      google.accounts.id.initialize({ client_id: env.googleClientId, callback: handleCredential });
      google.accounts.id.renderButton(containerRef.current, { theme: "outline", size: "large", width: 320 });
    }

    if ((window as unknown as { google?: unknown }).google) {
      render();
      return;
    }

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    return () => script?.removeEventListener("load", render);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!env.googleClientId) return null;

  return <div ref={containerRef} className="flex justify-center" />;
}
