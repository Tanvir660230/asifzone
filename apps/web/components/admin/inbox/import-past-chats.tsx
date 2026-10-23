"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { describeApiError } from "@/lib/api-client";
import * as settingsApi from "@/lib/api/settings";

const RANGES = [7, 30, 90] as const;

/** Settings › Integrations › Facebook & Instagram messages: copies recent Messenger / Instagram chats into the Inbox,
 * once (running it again only adds what's new). Meta shares the 20 latest messages of each chat. */
export function ImportPastChats() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const run = useMutation({
    mutationFn: () => settingsApi.importPastChats(days),
    onSuccess: () => toast.success("Import started — past chats appear in the Inbox within a few minutes"),
    onError: (err) => toast.error(describeApiError(err, "Couldn't start the import")),
  });
  return (
    <div className="space-y-2 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
      <p className="font-medium text-ink-800">Bring in past chats</p>
      <p>Copies recent Messenger and Instagram conversations into the Inbox — the latest 20 messages of each, as Meta allows. The AI doesn&apos;t answer old messages.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="import-days" className="sr-only">
          How far back
        </label>
        <Select id="import-days" className="h-8 w-auto py-0 text-[13px]" value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof RANGES)[number])}>
          {RANGES.map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </Select>
        <Button type="button" size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate()}>
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Import past chats
        </Button>
      </div>
    </div>
  );
}
