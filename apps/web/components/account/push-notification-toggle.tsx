"use client";

import { useEffect, useState } from "react";
import {
  getExistingPushSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-notifications";
import { registerPushSubscription, unregisterPushSubscription } from "@/lib/api/push";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

export function PushNotificationToggle() {
  const [supported, setSupported] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) return;
    setSupported(true);
    getExistingPushSubscription().then(setSubscription);
  }, []);

  async function handleEnable() {
    setBusy(true);
    try {
      const sub = await subscribeToPush();
      await registerPushSubscription(sub);
      setSubscription(sub);
      toast.success("Push notifications enabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't enable push notifications");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (!subscription) return;
    setBusy(true);
    try {
      const endpoint = subscription.endpoint;
      await unsubscribeFromPush(subscription);
      await unregisterPushSubscription(endpoint);
      setSubscription(null);
      toast.success("Push notifications disabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disable push notifications");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-ink-100 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-ink-900">Push notifications</p>
        <p className="text-xs text-ink-500">
          {subscription ? "Enabled on this browser" : "Get flash sale and order updates in your browser"}
        </p>
      </div>
      {subscription ? (
        <Button type="button" variant="outline" onClick={handleDisable} disabled={busy}>
          {busy ? "Working…" : "Disable"}
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={handleEnable} disabled={busy}>
          {busy ? "Working…" : "Enable"}
        </Button>
      )}
    </div>
  );
}
