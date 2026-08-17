"use client";

import { useEffect, useRef } from "react";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/api-client";

const SCRIPT_ID = "google-identity-services";

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleNotification {
  isNotDisplayed: () => boolean;
  isSkippedMoment: () => boolean;
  isDismissedMoment: () => boolean;
  getNotDisplayedReason: () => string;
  getSkippedReason: () => string;
  getDismissedReason: () => string;
}

// Minimal shape for the two Google Identity Services calls actually used below — the full API
// surface has no first-party types available without pulling in a whole extra dependency for it.
interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        use_fedcm_for_prompt?: boolean;
      }) => void;
      renderButton: (parent: HTMLElement, options: { theme: string; size: string; width: number }) => void;
      prompt: (callback?: (notification: GoogleNotification) => void) => void;
    };
  };
}

/** Loads Google Identity Services directly (no @react-oauth/google dependency — this is the only
 * thing we need it for). Owns nothing about what the credential means — the caller's onCredential
 * decides whether that idToken logs in a customer or an admin — so both account and admin login
 * pages can drop this in without duplicating the script-loading/One Tap boilerplate. Renders nothing
 * at all when NEXT_PUBLIC_GOOGLE_CLIENT_ID isn't set, same "quietly absent until configured" pattern
 * as the AI features when ANTHROPIC_API_KEY is unset. */
export function GoogleButton({
  onCredential,
  onError,
}: {
  onCredential: (idToken: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!env.googleClientId) return;

    async function handleCredential(response: GoogleCredentialResponse) {
      try {
        await onCredential(response.credential);
      } catch (err) {
        onError(err instanceof ApiError ? err.message : "Google sign-in failed, please try again");
      }
    }

    function render() {
      const google = (window as unknown as { google?: GoogleIdentityServices }).google;
      if (!google || !containerRef.current) return;

      google.accounts.id.initialize({
        client_id: env.googleClientId,
        callback: handleCredential,
        auto_select: true,
        cancel_on_tap_outside: false,
        // Chrome/Firefox now block the legacy One Tap prompt outright once third-party cookies are
        // off unless this is set — without it, prompt() fails silently with no visible error.
        use_fedcm_for_prompt: true,
      });
      google.accounts.id.renderButton(containerRef.current, { theme: "outline", size: "large", width: 320 });
      // Shows the One Tap prompt in the corner, auto-suggesting the visitor's signed-in Google
      // account so returning users don't have to click the button at all. Logged so a silent
      // no-show (not signed into Google, prior dismissal cooldown, browser blocking it, ...) is
      // diagnosable from devtools instead of just "nothing happened".
      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed()) {
          console.info("[Google One Tap] not displayed:", notification.getNotDisplayedReason());
        } else if (notification.isSkippedMoment()) {
          console.info("[Google One Tap] skipped:", notification.getSkippedReason());
        }
      });
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
