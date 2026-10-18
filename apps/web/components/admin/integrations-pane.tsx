"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
import {
  INTEGRATIONS,
  INTEGRATION_GROUP_LABELS,
  type IntegrationDefinition,
  type IntegrationFieldState,
  type IntegrationGroup,
  type IntegrationState,
  type IntegrationsView,
} from "@clothing-brand/shared";
import { FormSection } from "@/components/admin/form-section";
import { ConnectWhatsApp } from "@/components/admin/inbox/connect-whatsapp";
import { ImportPastChats } from "@/components/admin/inbox/import-past-chats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { describeApiError } from "@/lib/api-client";
import * as settingsApi from "@/lib/api/settings";

const QUERY_KEY = ["settings-integrations"];
const GROUPS = Object.keys(INTEGRATION_GROUP_LABELS) as IntegrationGroup[];

/** A random token for a webhook (Steadfast, Meta) — our own shared secret, not issued by them. */
function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sourceNote(field: IntegrationFieldState, secret: boolean): string | null {
  if (field.unreadable) return "The saved value can't be read on this server any more — enter it again.";
  if (field.source === "server") return secret ? `Set on the server (${field.hint ?? "…"}). A value saved here replaces it.` : "Set on the server. A value saved here replaces it.";
  if (field.source === "dashboard" && secret) return `Saved (${field.hint ?? "…"}). Enter a new value to replace it.`;
  return null;
}

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error("Couldn't copy"),
  );
}

/** The two values the owner pastes into their Meta app › Webhooks, and the events to subscribe to. */
function MetaWebhookHelp({ url, token, unsaved, onGenerate }: { url: string; token: string | null; unsaved: boolean; onGenerate: () => void }) {
  return (
    <div className="space-y-3 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink-800">For your Meta app › Webhooks</p>
        <Button type="button" size="sm" variant="ghost" onClick={onGenerate}>
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          Generate verify token
        </Button>
      </div>
      <div>
        <p className="text-ink-500">Callback URL</p>
        <div className="mt-0.5 flex items-start justify-between gap-2">
          <p className="min-w-0 break-all font-mono text-[11px] text-ink-700">{url}</p>
          <Button type="button" size="sm" variant="link" className="shrink-0 text-xs" onClick={() => copy(url, "Callback URL")}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            Copy
          </Button>
        </div>
      </div>
      <div>
        <p className="text-ink-500">Verify token</p>
        {token ? (
          <div className="mt-0.5 flex items-start justify-between gap-2">
            <p className="min-w-0 break-all font-mono text-[11px] text-ink-700">{token}</p>
            <Button type="button" size="sm" variant="link" className="shrink-0 text-xs" onClick={() => copy(token, "Verify token")}>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              {unsaved ? "Copy — save first" : "Copy"}
            </Button>
          </div>
        ) : (
          <p className="mt-0.5">The saved token stays hidden. Generate a new one to see it.</p>
        )}
      </div>
      <p>
        Subscribe to — Page: <span className="font-mono">messages, message_echoes, feed</span> · Instagram: <span className="font-mono">messages</span> ·
        WhatsApp: <span className="font-mono">messages, smb_message_echoes</span>
      </p>
    </div>
  );
}

function IntegrationCard({ definition, state, view }: { definition: IntegrationDefinition; state: IntegrationState; view: IntegrationsView }) {
  const { steadfastWebhookUrl } = view;
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirmDialog();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  /** A webhook token generated in this visit stays visible after saving, so its Notify URL can still be copied. */
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [savedVerifyToken, setSavedVerifyToken] = useState<string | null>(null);
  const fieldState = (key: string) => state.fields.find((f) => f.key === key)!;
  const anyUnreadable = state.fields.some((f) => f.unreadable);

  const onSaved = (view: IntegrationsView) => {
    queryClient.setQueryData(QUERY_KEY, view);
    void queryClient.invalidateQueries({ queryKey: ["provider-capabilities"] });
  };
  const save = useMutation({
    mutationFn: settingsApi.updateIntegrations,
    onSuccess: (view, values) => {
      onSaved(view);
      if (values.STEADFAST_WEBHOOK_TOKEN !== undefined) setSavedToken(values.STEADFAST_WEBHOOK_TOKEN);
      if (values.META_WEBHOOK_VERIFY_TOKEN !== undefined) setSavedVerifyToken(values.META_WEBHOOK_VERIFY_TOKEN);
      setDraft({});
      toast.success(`${definition.name} saved`);
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't save")),
  });
  const generateKeys = useMutation({
    mutationFn: settingsApi.generateWebPushKeys,
    onSuccess: (view) => {
      onSaved(view);
      toast.success("New web-push keys saved");
    },
    onError: (err) => toast.error(describeApiError(err, "Couldn't generate keys")),
  });

  const changed = Object.entries(draft).filter(([key, value]) => {
    const current = fieldState(key);
    return definition.fields.find((f) => f.key === key)?.kind === "secret" ? value.trim() !== "" : value.trim() !== (current.value ?? "");
  });

  async function remove(key: string, label: string) {
    const ok = await confirm(`Remove the ${label} saved for ${definition.name}?`, {
      title: "Remove saved value",
      confirmLabel: "Remove",
      details: fieldState(key).source === "dashboard" ? <p className="text-xs text-ink-500">If the server has its own value, that one applies again.</p> : undefined,
    });
    if (ok) save.mutate({ [key]: null });
  }

  async function regenerateKeys() {
    const hasKeys = fieldState("WEB_PUSH_PUBLIC_KEY").source !== "none";
    if (hasKeys) {
      const ok = await confirm("Customers who already turned on notifications will stop receiving them until they turn them on again.", {
        title: "Replace web-push keys?",
        confirmLabel: "Replace keys",
      });
      if (!ok) return;
    }
    generateKeys.mutate();
  }

  const status = anyUnreadable ? (
    <Badge variant="warning" dot>Needs re-entry</Badge>
  ) : state.configured ? (
    <Badge variant="success" dot>Connected</Badge>
  ) : state.fields.some((f) => f.source !== "none") ? (
    <Badge variant="warning" dot>Incomplete</Badge>
  ) : (
    <Badge variant="neutral">Not set up</Badge>
  );

  const webhookToken = draft.STEADFAST_WEBHOOK_TOKEN?.trim() || savedToken;

  return (
    <li className="rounded-xl border border-line-subtle bg-surface">
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-ink-900">{definition.name}</p>
            {status}
          </div>
          <p className="mt-0.5 text-xs text-ink-500">{definition.description}</p>
        </div>
        <Button type="button" size="sm" variant="outline" aria-expanded={open} aria-controls={`integration-${definition.id}`} onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : state.configured ? "Edit" : "Set up"}
        </Button>
      </div>

      {open && (
        <form
          id={`integration-${definition.id}`}
          className="space-y-4 border-t border-line-subtle p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (changed.length) save.mutate(Object.fromEntries(changed.map(([k, v]) => [k, v.trim()])));
          }}
        >
          <p className="text-xs text-ink-500">Where to find these: {definition.docsHint}.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {definition.fields.map((field) => {
              const current = fieldState(field.key);
              const id = `int-${field.key}`;
              const note = sourceNote(current, field.kind === "secret");
              const value = draft[field.key] ?? (field.kind === "secret" ? "" : (current.value ?? ""));
              const set = (next: string) => setDraft((d) => ({ ...d, [field.key]: next }));
              return (
                <Field key={field.key} htmlFor={id} label={field.label} required={field.required} hint={[field.help, note].filter(Boolean).join(" ") || undefined}>
                  {field.kind === "select" ? (
                    <Select id={id} value={value || field.options![0]!.value} onChange={(e) => set(e.target.value)}>
                      {field.options!.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      id={id}
                      type={field.kind === "secret" ? "password" : "text"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={field.kind === "secret" && current.source !== "none" ? "••••••••" : field.placeholder}
                      value={value}
                      onChange={(e) => set(e.target.value)}
                    />
                  )}
                </Field>
              );
            })}
          </div>

          {definition.id === "steadfast" && (
            <div className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-ink-800">Notify URL for the Steadfast panel</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, STEADFAST_WEBHOOK_TOKEN: randomToken() }))}>
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  Generate token
                </Button>
              </div>
              <p className="mt-1 break-all font-mono text-[11px] text-ink-700">
                {steadfastWebhookUrl}
                {webhookToken || "<your token>"}
              </p>
              {webhookToken ? (
                <Button
                  type="button"
                  size="sm"
                  variant="link"
                  className="mt-1 text-xs"
                  onClick={() => navigator.clipboard.writeText(`${steadfastWebhookUrl}${webhookToken}`).then(() => toast.success("Notify URL copied"), () => toast.error("Couldn't copy"))}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  {draft.STEADFAST_WEBHOOK_TOKEN ? "Copy URL — save, then paste it in Steadfast" : "Copy URL"}
                </Button>
              ) : (
                <p className="mt-1">The saved token stays hidden. Generate a new one to see the full URL.</p>
              )}
            </div>
          )}

          {definition.id === "meta-app" && (
            <MetaWebhookHelp
              url={view.metaWebhookUrl}
              token={draft.META_WEBHOOK_VERIFY_TOKEN?.trim() || savedVerifyToken}
              unsaved={Boolean(draft.META_WEBHOOK_VERIFY_TOKEN?.trim())}
              onGenerate={() => setDraft((d) => ({ ...d, META_WEBHOOK_VERIFY_TOKEN: randomToken() }))}
            />
          )}

          {definition.id === "meta-messages" && state.configured && <ImportPastChats />}

          {definition.id === "whatsapp" &&
            (() => {
              const appId = view.integrations.find((i) => i.id === "meta-app")?.fields.find((f) => f.key === "META_APP_ID")?.value;
              const configId = fieldState("WHATSAPP_SIGNUP_CONFIG_ID").value;
              return appId && configId ? (
                <ConnectWhatsApp appId={appId} configId={configId} onConnected={onSaved} />
              ) : (
                <p className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
                  To connect your number in one step, save the App ID (Meta app card) and the Embedded Signup configuration ID here — a
                  Connect WhatsApp button then appears.
                </p>
              );
            })()}

          {definition.id === "webpush" && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
              <p>Creates a new key pair for this store.</p>
              <Button type="button" size="sm" variant="ghost" loading={generateKeys.isPending} onClick={regenerateKeys}>
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                Generate keys
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {definition.fields
                .filter((f) => fieldState(f.key).source === "dashboard" || fieldState(f.key).unreadable)
                .map((f) => (
                  <Button key={f.key} type="button" size="sm" variant="link" className="text-xs text-ink-500" disabled={save.isPending} onClick={() => remove(f.key, f.label)}>
                    Remove {f.label}
                  </Button>
                ))}
            </div>
            <div className="flex items-center gap-3">
              {changed.length > 0 && !save.isPending && <span className="text-[12px] text-fg-subtle">Unsaved changes</span>}
              <Button type="submit" size="sm" disabled={!changed.length} loading={save.isPending}>
                Save
              </Button>
            </div>
          </div>
        </form>
      )}
    </li>
  );
}

/** Settings › Integrations: every third-party service the store talks to, with its credentials saved per store. */
export function IntegrationsPane() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: QUERY_KEY, queryFn: settingsApi.getIntegrations });

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading integrations">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-xl border border-line-subtle bg-surface p-4 text-sm">
        <p className="text-danger-600">Couldn&apos;t load the integrations.</p>
        <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-ink-500">
        Keys are stored encrypted for this store only and are never shown again after saving. A value saved here takes effect right away and replaces any
        value set on the server.
      </p>
      {GROUPS.map((group) => {
        const definitions = INTEGRATIONS.filter((i) => i.group === group);
        return (
          <FormSection key={group} title={INTEGRATION_GROUP_LABELS[group]}>
            <ul className="space-y-3">
              {definitions.map((definition) => {
                const state = data.integrations.find((s) => s.id === definition.id);
                return state ? <IntegrationCard key={definition.id} definition={definition} state={state} view={data} /> : null;
              })}
            </ul>
          </FormSection>
        );
      })}
    </div>
  );
}
