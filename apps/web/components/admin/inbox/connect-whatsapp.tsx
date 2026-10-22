"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import type { IntegrationsView, WhatsAppConnectInput } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { describeApiError } from "@/lib/api-client";
import * as settingsApi from "@/lib/api/settings";

/** The Graph API version the Facebook SDK speaks (same as the API's META_GRAPH_VERSION). */
const GRAPH_VERSION = "v26.0";
const SDK_ID = "facebook-jssdk";
/** Meta's sign-up posts the account ids to the page shortly before or after the login callback returns the code. */
const SESSION_WAIT_MS = 8_000;

interface FacebookSdk {
  init(options: { appId: string; version: string; xfbml?: boolean; cookie?: boolean }): void;
  login(callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void, options: Record<string, unknown>): void;
}
type SignupSession = { wabaId: string; phoneNumberId?: string; event: string };

function loadSdk(appId: string): Promise<FacebookSdk> {
  const w = window as unknown as { FB?: FacebookSdk; fbAsyncInit?: () => void };
  const ready = () => {
    w.FB!.init({ appId, version: GRAPH_VERSION, xfbml: false, cookie: false });
    return w.FB!;
  };
  if (w.FB) return Promise.resolve(ready());
  return new Promise((resolve, reject) => {
    w.fbAsyncInit = () => resolve(ready());
    if (!document.getElementById(SDK_ID)) {
      const script = document.createElement("script");
      script.id = SDK_ID;
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onerror = () => reject(new Error("Couldn't load Facebook's sign-up — check your connection or an ad blocker."));
      document.head.appendChild(script);
    }
  });
}

/**
 * Settings › Integrations › WhatsApp: links the store's WhatsApp number through Meta's Embedded Signup. The owner signs in
 * to Meta in a popup and picks the number; for the current number they confirm on the phone (coexistence: the WhatsApp
 * Business app keeps working). The popup gives this page a one-time code and the account ids; the API does the rest.
 */
export function ConnectWhatsApp({ appId, configId, onConnected }: { appId: string; configId: string; onConnected: (view: IntegrationsView) => void }) {
  const [mode, setMode] = useState<"current" | "new">("current");
  const [waiting, setWaiting] = useState(false);
  const session = useRef<SignupSession | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Meta's popup reports which account and number were chosen through postMessage.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      try {
        if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event === "FINISH" || data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
          session.current = { wabaId: String(data.data?.waba_id ?? ""), phoneNumberId: data.data?.phone_number_id ? String(data.data.phone_number_id) : undefined, event: data.event };
        } else if (data.event === "CANCEL") {
          session.current = null;
        }
      } catch {
        // not Meta's sign-up message
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const connect = useMutation({
    mutationFn: (input: WhatsAppConnectInput) => settingsApi.connectWhatsApp(input),
    onSuccess: (result) => {
      onConnected(result.view);
      setWarnings(result.warnings);
      toast.success(result.phoneNumber ? `WhatsApp connected — ${result.phoneNumber}` : "WhatsApp connected");
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't connect WhatsApp")),
  });

  async function start() {
    session.current = null;
    setWarnings([]);
    setWaiting(true);
    try {
      const FB = await loadSdk(appId);
      FB.login(
        (response) => {
          const code = response.authResponse?.code;
          if (!code) {
            setWaiting(false);
            if (response.status !== "unknown") toast.error("WhatsApp sign-up wasn't finished.");
            return;
          }
          // The code lives 30 seconds: wait briefly for the account ids, then hand both to the API.
          const startedAt = Date.now();
          const tick = () => {
            const s = session.current;
            if (s?.wabaId) {
              setWaiting(false);
              connect.mutate({ code, wabaId: s.wabaId, phoneNumberId: s.phoneNumberId, coexistence: s.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" || mode === "current" });
            } else if (Date.now() - startedAt > SESSION_WAIT_MS) {
              setWaiting(false);
              toast.error("Meta didn't say which WhatsApp account was chosen — press Connect WhatsApp again.");
            } else {
              window.setTimeout(tick, 250);
            }
          };
          tick();
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            setup: {},
            sessionInfoVersion: "3",
            ...(mode === "current" ? { featureType: "whatsapp_business_app_onboarding" } : {}),
          },
        },
      );
    } catch (err) {
      setWaiting(false);
      toast.error(err instanceof Error ? err.message : "Couldn't start WhatsApp sign-up");
    }
  }

  const busy = waiting || connect.isPending;
  return (
    <div className="space-y-3 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink-800">Connect your WhatsApp number</p>
        <SegmentedControl
          aria-label="Which number"
          value={mode}
          onChange={setMode}
          options={[
            { value: "current", label: "Current number" },
            { value: "new", label: "New number" },
          ]}
        />
      </div>
      <p>
        {mode === "current"
          ? "The number on your WhatsApp Business app (2.24.17 or newer). It keeps working on the phone, and its contacts and recent chats are copied once. Keep the phone nearby to confirm."
          : "A number that isn't on any WhatsApp app. It will only work from the Inbox."}
      </p>
      <Button type="button" size="sm" onClick={start} loading={busy} disabled={busy}>
        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {connect.isPending ? "Connecting…" : waiting ? "Waiting for Meta…" : "Connect WhatsApp"}
      </Button>
      {warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-4 text-warning-700" aria-live="polite">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
