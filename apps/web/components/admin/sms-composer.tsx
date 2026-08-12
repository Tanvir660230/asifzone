"use client";

import { type RefObject, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { CUSTOMER_SMS_VARIABLES, renderCustomerSmsTemplate } from "@clothing-brand/shared";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TemplateManagerModal } from "@/components/admin/template-manager-modal";
import * as smsTemplatesApi from "@/lib/api/sms-templates";
import { formatPrice } from "@/lib/format";
import { env } from "@/lib/env";

interface PreviewContext {
  name: string;
  phone?: string | null;
  totalSpent?: number;
  lastOrderAt?: string | null;
}

interface SmsComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** When set, renders a live preview of the message with this customer's variables filled in. */
  previewContext?: PreviewContext;
  previewLabel?: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  maxLength?: number;
}

/** Template picker + {{variable}} insert chips + textarea + live preview — shared by the customer
 * drawer's individual Send SMS card and the customer list's bulk-send modal, so both compose the
 * same way against the same reusable SmsTemplate rows. */
export function SmsComposer({
  value,
  onChange,
  previewContext,
  previewLabel,
  textareaRef,
  maxLength = 1000,
}: SmsComposerProps) {
  const [manageOpen, setManageOpen] = useState(false);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? internalRef;

  const { data } = useQuery({ queryKey: ["sms-templates"], queryFn: smsTemplatesApi.listSmsTemplates });
  const templates = data?.templates ?? [];

  function insertToken(token: string) {
    const el = ref.current;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }

  const preview = useMemo(() => {
    if (!previewContext || !value.trim()) return null;
    return renderCustomerSmsTemplate(value, {
      customerName: previewContext.name,
      firstName: previewContext.name.split(" ")[0] || previewContext.name,
      phone: previewContext.phone ?? "",
      totalSpent: formatPrice(previewContext.totalSpent ?? 0),
      lastOrder: previewContext.lastOrderAt
        ? new Date(previewContext.lastOrderAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : "no orders yet",
      website: env.siteUrl,
    });
  }, [value, previewContext]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          className="h-8 w-48"
          value=""
          onChange={(e) => {
            const t = templates.find((t) => t.id === e.target.value);
            if (t) onChange(t.body);
          }}
        >
          <option value="">Use a template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900"
        >
          <Settings2 size={12} /> Manage templates
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {CUSTOMER_SMS_VARIABLES.map((v) => (
          <button
            key={v.token}
            type="button"
            onClick={() => insertToken(v.token)}
            title={`Insert ${v.label}`}
            className="rounded-full border border-ink-200 px-2 py-0.5 text-[11px] text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-900"
          >
            {v.token}
          </button>
        ))}
      </div>

      <Textarea
        ref={ref}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        placeholder="Type a message, or pick a template above…"
      />
      <div className="text-right text-xs text-ink-400">
        {value.length}/{maxLength}
      </div>

      {preview && (
        <div className="rounded-lg border border-info-200 bg-info-50 p-3 text-sm text-ink-700">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-info-600">
            Preview{previewLabel ? ` — ${previewLabel}` : ""}
          </p>
          {preview}
        </div>
      )}

      <TemplateManagerModal open={manageOpen} onClose={() => setManageOpen(false)} />
    </div>
  );
}
