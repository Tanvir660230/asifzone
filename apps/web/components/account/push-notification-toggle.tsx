"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  getExistingPushSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-notifications";
import { registerPushSubscription, unregisterPushSubscription } from "@/lib/api/push";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/** Push on/off for this browser. Renders nothing where push isn't supported — `renderShell` wraps the control in its
 * section (heading and all), so a page never shows a heading with nothing under it. */
export function PushNotificationToggle({ renderShell = (control) => control }: { renderShell?: (control: ReactNode) => ReactNode } = {}) {
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
      toast.success("Push notifications turned on");
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
      toast.success("Push notifications turned off");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disable push notifications");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return renderShell(
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-fg">Push notifications</p>
        <p className="text-sm text-fg-muted">{subscription ? "On in this browser" : "Off in this browser"}</p>
      </div>
      {subscription ? (
        <Button type="button" variant="outline" onClick={handleDisable} loading={busy}>
          Turn off
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={handleEnable} loading={busy}>
          Turn on
        </Button>
      )}
    </div>,
  );
}
