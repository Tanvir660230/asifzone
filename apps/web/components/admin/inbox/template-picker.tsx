"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { renderTemplate, type ConversationDetail } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { describeApiError } from "@/lib/api-client";
import * as inboxApi from "@/lib/api/inbox";

/**
 * WhatsApp after the 24-hour window: Meta allows only an approved template (it charges for each). Staff pick one,
 * fill its blanks, see exactly what the customer will get, and send. When the customer answers, the window reopens.
 */
export function TemplatePicker({ thread, onSent }: { thread: ConversationDetail; onSent: () => void }) {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["inbox", "whatsapp-templates"], queryFn: inboxApi.listWhatsAppTemplates, staleTime: 5 * 60_000 });
  const templates = data?.templates ?? [];
  const [key, setKey] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const template = templates.find((t) => `${t.name}|${t.language}` === key) ?? templates[0];

  const send = useMutation({
    mutationFn: () =>
      inboxApi.replyToConversation(thread.id, { channel: "WHATSAPP", template: { name: template!.name, language: template!.language, params: template!.params.map((_, i) => values[i]?.trim() ?? "") } }),
    onSuccess: () => {
      setValues([]);
      toast.success("Template queued · WhatsApp");
      onSent();
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't send the template")),
  });

  if (isLoading) return <div className="h-24 animate-pulse rounded-lg bg-ink-900/[0.04]" aria-busy="true" aria-label="Loading templates" />;
  if (isError) {
    return (
      <p className="text-[13px] text-fg-muted">
        {describeApiError(error, "Couldn't load your WhatsApp templates.")}{" "}
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => refetch()}>
          Try again
        </button>
      </p>
    );
  }
  if (!template) {
    return (
      <p className="text-[13px] text-fg-muted">
        No approved templates yet. Create one in WhatsApp Manager › Message templates — for example &ldquo;Assalamu alaikum {"{{1}}"}, apnar order {"{{2}}"} er
        bepare kotha bolte chai.&rdquo; — and it appears here once Meta approves it.
      </p>
    );
  }

  const filled = template.params.every((_, i) => values[i]?.trim());
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="wa-template" className="text-[13px] text-fg-muted">
          Template
        </label>
        <Select
          id="wa-template"
          className="h-8 w-auto py-0 text-[13px]"
          value={`${template.name}|${template.language}`}
          onChange={(e) => {
            setKey(e.target.value);
            setValues([]);
          }}
        >
          {templates.map((t) => (
            <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
              {t.name} ({t.language})
            </option>
          ))}
        </Select>
      </div>
      {template.params.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {template.params.map((p, i) => (
            <div key={p} className="min-w-0">
              <label htmlFor={`wa-param-${i}`} className="mb-1 block text-[12px] text-fg-muted">
                {template.named ? p.replace(/_/g, " ") : `Blank ${p}`}
              </label>
              <Input id={`wa-param-${i}`} autoComplete="off" value={values[i] ?? ""} onChange={(e) => setValues((v) => Object.assign([...v], { [i]: e.target.value }))} />
            </div>
          ))}
        </div>
      )}
      <p className="whitespace-pre-wrap rounded-lg bg-ink-900/[0.03] px-3 py-2 text-[14px] leading-relaxed text-fg" aria-label="Preview">
        {renderTemplate(template, values)}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-fg-subtle">Meta charges for each template message. When they reply, you can write freely again.</p>
        <Button type="button" size="sm" disabled={!filled || send.isPending} loading={send.isPending} onClick={() => send.mutate()}>
          Send template
        </Button>
      </div>
    </div>
  );
}
