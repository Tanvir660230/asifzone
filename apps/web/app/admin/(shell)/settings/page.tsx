"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  CreditCard,
  Headphones,
  Lock,
  Palette,
  Plug,
  RotateCcw,
  Search,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import { updateSettingsSchema, type UpdateSettingsInput, type UpdateSocialLinkInput } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { IntegrationsPane } from "@/components/admin/integrations-pane";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { useProviderCapabilities } from "@/hooks/use-provider-capabilities";
import { ApiError } from "@/lib/api-client";
import * as socialLinksApi from "@/lib/api/admin-social-links";
import * as settingsApi from "@/lib/api/settings";
import { storeCurrencyCode } from "@/lib/format";

/** wa.me and api.whatsapp.com/send?phone= are the two URL shapes admins tend to paste (or that this
 * form itself writes) — read whichever one is there back out to a plain number for editing. */
function phoneFromWhatsAppUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("phone")) return parsed.searchParams.get("phone") ?? "";
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return "";
  }
}

function whatsAppUrlFromPhone(phone: string): string {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}`;
}

/** Self-contained number + on/off control for the WhatsApp contact button. Saves straight to its
 * backing SocialLink record (platform WHATSAPP) rather than through the main settings form, since
 * that's a separate resource/mutation — full add/reorder/remove for every platform still lives on
 * the Social Links page, this is just a shortcut for the one platform the contact widget needs. */
function WhatsAppQuickConfig() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-social-links"], queryFn: socialLinksApi.listSocialLinks });
  const link = data?.links.find((l) => l.platform === "WHATSAPP");
  const [number, setNumber] = useState("");
  const [numberDirty, setNumberDirty] = useState(false);

  useEffect(() => {
    if (!numberDirty) setNumber(link ? phoneFromWhatsAppUrl(link.url) : "");
  }, [link, numberDirty]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-social-links"] });
  const createMutation = useMutation({ mutationFn: socialLinksApi.createSocialLink, onSuccess: invalidate });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & UpdateSocialLinkInput) => socialLinksApi.updateSocialLink(id, input),
    onSuccess: invalidate,
  });
  const saving = createMutation.isPending || updateMutation.isPending;
  const active = link?.isActive ?? false;

  async function saveNumber() {
    if (number.trim() === "") {
      toast.error("Enter a WhatsApp number first");
      return;
    }
    try {
      const url = whatsAppUrlFromPhone(number);
      if (link) await updateMutation.mutateAsync({ id: link.id, url });
      else await createMutation.mutateAsync({ platform: "WHATSAPP", url, isActive: true, sortOrder: 0 });
      setNumberDirty(false);
      toast.success("WhatsApp number saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save WhatsApp number");
    }
  }

  async function toggleEnabled(checked: boolean) {
    if (!link) {
      if (!checked) return;
      if (number.trim() === "") {
        toast.error("Enter a WhatsApp number first");
        return;
      }
      await createMutation.mutateAsync({ platform: "WHATSAPP", url: whatsAppUrlFromPhone(number), isActive: true, sortOrder: 0 });
      return;
    }
    await updateMutation.mutateAsync({ id: link.id, isActive: checked });
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={active ? "success" : "neutral"}>{active ? "Visible on store" : "Hidden"}</Badge>
          <Link href="/admin/social-links" className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg">
            All social links
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">Show on storefront</span>
          <Switch aria-label="Show WhatsApp on storefront" checked={active} onChange={toggleEnabled} disabled={saving} />
        </div>
      </div>

      <div className="grid grid-cols-1 items-end gap-2.5 sm:grid-cols-[1fr_auto]">
        <div>
          <Label htmlFor="whatsappNumber">WhatsApp number</Label>
          <Input
            id="whatsappNumber"
            placeholder="8801XXXXXXXXX"
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
              setNumberDirty(true);
            }}
          />
        </div>
        <Button type="button" variant="outline" onClick={saveNumber} disabled={saving || (!numberDirty && Boolean(link))}>
          {saving ? "Saving…" : "Save number"}
        </Button>
      </div>
    </div>
  );
}

/** Shown under a payment gateway whose credentials aren't set yet. */
function IntegrationsHint() {
  return (
    <p className="mt-1 text-xs text-warning-600">
      Not connected yet —{" "}
      <Link href="/admin/settings?pane=integrations" className="underline underline-offset-2">
        add its keys in Integrations
      </Link>
      .
    </p>
  );
}

interface SettingsTabDef {
  value: SettingsTab;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  sections: readonly SettingsSection[];
}

/** Blueprint V2 P7: each section saves only its own fields (one PATCH → one settings audit entry), so saving one
 * section never sends another section's untouched — possibly stale — values. */
const SECTIONS = {
  store: ["storeName", "currency", "tagline", "logoUrl", "logoOnDarkUrl", "faviconUrl"],
  seo: ["googleSiteVerification", "seoTitle", "seoDescription", "ogImageUrl"],
  newsletter: ["newsletterHeading", "newsletterText"],
  contact: ["contactEmail", "contactPhone"],
  contactOptions: ["whatsappLabel", "whatsappMessage", "callEnabled", "callLabel", "liveChatEnabled", "liveChatLabel", "tawkPropertyId", "tawkWidgetId"],
  identity: ["legalName", "legalJurisdiction", "addressLine", "addressCity", "addressRegion", "addressPostalCode", "addressCountry", "supportHours"],
  policy: ["returnWindowDays", "returnPolicyKind", "returnConditions", "handlingDaysMin", "handlingDaysMax"],
  confirmation: ["confirmationMaxUnreached", "confirmationEscalateHours", "confirmationRetryMinutes", "confirmationNextDayHour"],
  dispatch: ["shippedSmsTrigger", "stuckInTransitDays", "returnNotBackDays"],
  courierFees: ["courierReturnFeeDhaka", "courierReturnFeeOutsideDhaka"],
  payments: ["codEnabled", "onlinePaymentEnabled", "epsPaymentEnabled"],
  tax: ["taxEnabled", "defaultTaxRate", "shippingTaxable"],
  rewards: ["rewardPointsPerCurrency"],
} as const satisfies Record<string, ReadonlyArray<keyof UpdateSettingsInput>>;
type SettingsSection = keyof typeof SECTIONS;

type SettingsTab = "branding" | "contact" | "operations" | "shipping" | "integrations";

const TABS: readonly SettingsTabDef[] = [
  {
    value: "branding",
    label: "Store & branding",
    shortLabel: "Branding",
    description: "Name, logos, SEO & newsletter",
    icon: Palette,
    sections: ["store", "seo", "newsletter"],
  },
  {
    value: "contact",
    label: "Contact & support",
    shortLabel: "Contact",
    description: "WhatsApp, call, chat & address",
    icon: Headphones,
    sections: ["contact", "contactOptions", "identity"],
  },
  {
    value: "operations",
    label: "Orders & delivery",
    shortLabel: "Orders",
    description: "Return policy, calls & courier",
    icon: Truck,
    sections: ["policy", "confirmation", "dispatch", "courierFees"],
  },
  {
    value: "shipping",
    label: "Checkout, tax & rewards",
    shortLabel: "Checkout",
    description: "Payments, VAT & loyalty points",
    icon: CreditCard,
    sections: ["payments", "tax", "rewards"],
  },
  {
    value: "integrations",
    label: "Integrations",
    shortLabel: "Integrations",
    description: "Steadfast, Meta, SMS & gateways",
    icon: Plug,
    sections: [],
  },
];

interface QuickFindItem {
  id: string;
  title: string;
  hint: string;
  keywords: string;
  pane?: SettingsTab;
  href?: string;
}

const QUICK_FIND_ITEMS: readonly QuickFindItem[] = [
  { id: "store", title: "Store information & logos", hint: "Store & branding", keywords: "store name currency tagline logo dark favicon", pane: "branding" },
  { id: "seo", title: "Search engines (SEO)", hint: "Store & branding", keywords: "google search console seo title description social sharing og image", pane: "branding" },
  { id: "newsletter", title: "Newsletter sign-up", hint: "Store & branding", keywords: "newsletter footer email subscribe heading", pane: "branding" },
  { id: "contact", title: "Contact email & phone", hint: "Contact & support", keywords: "email phone contact footer", pane: "contact" },
  { id: "contactOptions", title: "Floating contact button", hint: "Contact & support", keywords: "whatsapp direct call live chat tawk floating widget", pane: "contact" },
  { id: "identity", title: "Business identity & address", hint: "Contact & support", keywords: "legal name jurisdiction street address city postal country support hours", pane: "contact" },
  { id: "policy", title: "Store return & dispatch policy", hint: "Orders & delivery", keywords: "return exchange window days conditions handling dispatch time", pane: "operations" },
  { id: "confirmation", title: "Confirmation call rules", hint: "Orders & delivery", keywords: "confirmation call unanswered escalate retry hours minutes", pane: "operations" },
  { id: "dispatch", title: "Dispatch & courier follow-up", hint: "Orders & delivery", keywords: "dispatch steadfast stuck in transit overdue return sms", pane: "operations" },
  { id: "courierFees", title: "Courier return fees & zones", hint: "Orders & delivery", keywords: "courier return fee dhaka outside cancellation loss delivery", pane: "operations" },
  { id: "payments", title: "Payment methods at checkout", hint: "Checkout, tax & rewards", keywords: "cash on delivery cod online payment sslcommerz eps bkash nagad card", pane: "shipping" },
  { id: "tax", title: "Tax & VAT rules", hint: "Checkout, tax & rewards", keywords: "tax vat rate shipping taxable default", pane: "shipping" },
  { id: "rewards", title: "Customer reward points", hint: "Checkout, tax & rewards", keywords: "reward loyalty points currency", pane: "shipping" },
  { id: "integrations", title: "API keys & integrations", hint: "Integrations", keywords: "steadfast meta facebook tiktok pixel sms email sslcommerz eps webhook api key", pane: "integrations" },
  { id: "ext-delivery-zones", title: "Delivery zones & shipping fees", hint: "Settings page", keywords: "delivery zones shipping charge free delivery area dhaka", href: "/admin/settings/delivery-zones" },
  { id: "ext-payment-logos", title: "Payment method badges", hint: "Settings page", keywords: "payment logos badges checkout footer", href: "/admin/payment-methods" },
  { id: "ext-sms", title: "SMS notification templates", hint: "Settings page", keywords: "sms templates order shipped confirmed message", href: "/admin/sms-notifications" },
  { id: "ext-social", title: "Social media links", hint: "Online store", keywords: "facebook instagram youtube tiktok social links", href: "/admin/social-links" },
  { id: "ext-rates", title: "Courier & gateway rate cards", hint: "Books setup", keywords: "steadfast rate card cod charge eps fee", href: "/admin/finance/rates" },
];

const RELATED_PAGES: ReadonlyArray<{ label: string; hint: string; href: string }> = [
  { label: "Delivery zones", hint: "Area shipping fees & free limits", href: "/admin/settings/delivery-zones" },
  { label: "SMS templates", hint: "Order & delivery messages", href: "/admin/sms-notifications" },
  { label: "Payment badges", hint: "Footer & checkout logos", href: "/admin/payment-methods" },
  { label: "Courier & gateway rates", hint: "Steadfast & EPS fee schedule", href: "/admin/finance/rates" },
];

function SettingsLoadingSkeleton() {
  return (
    <div>
      <PageHeader title="Settings" />
      <ModuleTabs />
      <div className="ui-settings-shell">
        <div className="ui-settings-nav">
          <div className="ui-skeleton h-10 w-full rounded-lg" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="ui-skeleton h-14 w-full rounded-xl" />
            ))}
          </div>
        </div>
        <div className="space-y-5">
          <div className="ui-settings-card space-y-4">
            <div className="ui-skeleton h-5 w-40" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="ui-skeleton h-10 w-full rounded-lg" />
              <div className="ui-skeleton h-10 w-full rounded-lg" />
              <div className="ui-skeleton h-10 w-full rounded-lg sm:col-span-2" />
            </div>
          </div>
          <div className="ui-settings-card space-y-4">
            <div className="ui-skeleton h-5 w-36" />
            <div className="ui-skeleton h-20 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: SettingsTab = TABS.find((t) => t.value === searchParams.get("pane"))?.value ?? "branding";
  const setTab = (next: SettingsTab) =>
    router.replace(next === "branding" ? pathname : `${pathname}?pane=${next}`, { scroll: false });

  const [query, setQuery] = useState("");
  const [savingSection, setSavingSection] = useState<SettingsSection | null>(null);
  const loaded = useRef(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.getSettings,
  });
  const gateways = useProviderCapabilities(); // Phase 12 D-4
  const { can, ready: authReady } = useCapabilities();
  const canManageSettings = can("settings.manage");

  const {
    register,
    control,
    reset,
    watch,
    setValue,
    trigger,
    getValues,
    resetField,
    formState: { errors, dirtyFields },
  } = useForm<UpdateSettingsInput>({ resolver: zodResolver(updateSettingsSchema) });

  const logoUrl = watch("logoUrl");
  const logoOnDarkUrl = watch("logoOnDarkUrl");
  const faviconUrl = watch("faviconUrl");
  const ogImageUrl = watch("ogImageUrl");

  // Filled once: a later refetch must not wipe what's being edited in another section.
  useEffect(() => {
    if (!data || loaded.current) return;
    loaded.current = true;
    const s = data.settings;
    reset({
      storeName: s.storeName,
      tagline: s.tagline,
      logoUrl: s.logoUrl,
      logoOnDarkUrl: s.logoOnDarkUrl,
      faviconUrl: s.faviconUrl,
      ogImageUrl: s.ogImageUrl,
      seoTitle: s.seoTitle,
      seoDescription: s.seoDescription,
      newsletterHeading: s.newsletterHeading,
      newsletterText: s.newsletterText,
      currency: s.currency,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      courierReturnFeeDhaka: Number(s.courierReturnFeeDhaka),
      courierReturnFeeOutsideDhaka: Number(s.courierReturnFeeOutsideDhaka),
      taxEnabled: s.taxEnabled,
      defaultTaxRate: s.defaultTaxRate ? Number(s.defaultTaxRate) : undefined,
      shippingTaxable: s.shippingTaxable ?? true,
      rewardPointsPerCurrency: Number(s.rewardPointsPerCurrency),
      whatsappMessage: s.whatsappMessage,
      whatsappLabel: s.whatsappLabel,
      callEnabled: s.callEnabled,
      callLabel: s.callLabel,
      liveChatEnabled: s.liveChatEnabled,
      liveChatLabel: s.liveChatLabel,
      tawkPropertyId: s.tawkPropertyId,
      tawkWidgetId: s.tawkWidgetId,
      codEnabled: s.codEnabled,
      onlinePaymentEnabled: s.onlinePaymentEnabled,
      epsPaymentEnabled: s.epsPaymentEnabled,
      googleSiteVerification: s.googleSiteVerification,
      legalName: s.legalName,
      addressLine: s.addressLine,
      addressCity: s.addressCity,
      addressRegion: s.addressRegion,
      addressPostalCode: s.addressPostalCode,
      addressCountry: s.addressCountry,
      legalJurisdiction: s.legalJurisdiction,
      supportHours: s.supportHours,
      returnWindowDays: s.returnWindowDays,
      returnPolicyKind: s.returnPolicyKind ?? "RETURN",
      returnConditions: s.returnConditions,
      handlingDaysMin: s.handlingDaysMin,
      handlingDaysMax: s.handlingDaysMax,
      confirmationMaxUnreached: s.confirmationMaxUnreached ?? 4,
      confirmationEscalateHours: s.confirmationEscalateHours ?? 72,
      confirmationRetryMinutes: s.confirmationRetryMinutes ?? 120,
      confirmationNextDayHour: s.confirmationNextDayHour ?? 10,
      shippedSmsTrigger: s.shippedSmsTrigger ?? "BOOKING",
      stuckInTransitDays: s.stuckInTransitDays ?? 6,
      returnNotBackDays: s.returnNotBackDays ?? 14,
    });
  }, [data, reset]);

  const updateMutation = useMutation({
    mutationFn: settingsApi.updateSettings,
    onSuccess: (saved) => {
      // The response is the whole settings row: the shell (store name, logo) reads it without a refetch.
      queryClient.setQueryData(["settings"], saved);
      toast.success("Saved");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Couldn't save"),
  });

  const isSectionDirty = (section: SettingsSection) =>
    SECTIONS[section].some((f) => Boolean((dirtyFields as Record<string, unknown>)[f]));

  const isTabDirty = (t: SettingsTabDef) => t.sections.some(isSectionDirty);

  async function saveSection(section: SettingsSection) {
    const fields = SECTIONS[section];
    if (!(await trigger([...fields]))) return;
    const values = getValues();
    const payload = Object.fromEntries(fields.map((f) => [f, values[f]])) as UpdateSettingsInput;
    setSavingSection(section);
    updateMutation.mutate(payload, {
      onSuccess: () => fields.forEach((f) => resetField(f, { defaultValue: values[f] as never })),
      onSettled: () => setSavingSection(null),
    });
  }

  function discardSection(section: SettingsSection) {
    SECTIONS[section].forEach((f) => resetField(f));
  }

  function sectionFooter(section: SettingsSection) {
    const dirty = isSectionDirty(section);
    const saving = savingSection === section;
    return (
      <div className="ui-settings-footer">
        <div className="flex items-center gap-2 text-xs">
          {dirty ? (
            <>
              <span className="ui-settings-dirty-dot" aria-hidden="true" />
              <span className="font-medium text-warning-600">Unsaved changes</span>
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
              <span className="text-fg-subtle">Up to date</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirty && !saving && (
            <Button type="button" size="sm" variant="ghost" onClick={() => discardSection(section)}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Discard
            </Button>
          )}
          <Button type="button" size="sm" disabled={!dirty || updateMutation.isPending} onClick={() => saveSection(section)}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    );
  }

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    return QUICK_FIND_ITEMS.filter((item) => {
      const haystack = `${item.title} ${item.hint} ${item.keywords}`.toLowerCase();
      return tokens.every((tok) => haystack.includes(tok));
    }).slice(0, 6);
  }, [query]);

  function jumpToItem(item: QuickFindItem) {
    setQuery("");
    if (item.href) {
      router.push(item.href);
      return;
    }
    if (item.pane) {
      setTab(item.pane);
      requestAnimationFrame(() => {
        setTimeout(() => {
          document.getElementById(`settings-section-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 40);
      });
    }
  }

  const taxEnabled = watch("taxEnabled");
  const callEnabled = watch("callEnabled");
  const liveChatEnabled = watch("liveChatEnabled");
  const codEnabled = watch("codEnabled");
  const onlinePaymentEnabled = watch("onlinePaymentEnabled");
  const epsPaymentEnabled = watch("epsPaymentEnabled");
  const isLastPaymentMethodEnabled =
    (codEnabled ? 1 : 0) + (onlinePaymentEnabled ? 1 : 0) + (epsPaymentEnabled ? 1 : 0) === 1;

  if (isLoading) return <SettingsLoadingSkeleton />;

  if (isError) {
    return (
      <div>
        <PageHeader title="Settings" />
        <ModuleTabs />
        <ErrorState
          title="Couldn't load store settings"
          description="Check your connection and try again."
          onRetry={() => refetch()}
          variant="bordered"
        />
      </div>
    );
  }

  if (authReady && !canManageSettings) {
    return (
      <div>
        <PageHeader title="Settings" />
        <ModuleTabs />
        <EmptyState
          icon={Lock}
          variant="bordered"
          title="Owner access required"
          description="Only store owners can view or change store settings."
        />
      </div>
    );
  }

  const activeTabMeta = TABS.find((t) => t.value === tab) ?? TABS[0]!;
  const currencyCode = storeCurrencyCode();

  const searchBox = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a setting…"
        aria-label="Find a setting"
        className="pl-9 pr-8"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery("")}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {query.trim().length > 0 && (
        <div className="ui-floating absolute inset-x-0 top-full z-20 mt-1.5 p-1.5">
          {searchResults.length > 0 ? (
            <ul className="space-y-0.5">
              {searchResults.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => jumpToItem(item)}
                    className="ui-menu-item justify-between"
                  >
                    <span className="min-w-0 truncate font-medium">{item.title}</span>
                    <span className="shrink-0 text-xs opacity-70">{item.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2.5 py-2 text-xs text-fg-muted">No matching settings found.</p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Settings"
        description={activeTabMeta.description}
      />
      <ModuleTabs />

      {/* Mobile & tablet: quick search + swipeable single-row category pills */}
      <div className="mb-4 space-y-3 lg:hidden">
        {searchBox}
        <nav aria-label="Settings categories" className="ui-settings-pill-bar">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = t.value === tab;
            const dirty = isTabDirty(t);
            return (
              <button
                key={t.value}
                type="button"
                data-active={active ? "true" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => setTab(t.value)}
                className="ui-settings-pill"
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{t.shortLabel}</span>
                {dirty && <span className="ui-settings-dirty-dot" title="Unsaved changes" />}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="ui-settings-shell">
        {/* Desktop: sticky category navigation rail + quick search + related shortcuts */}
        <aside className="ui-settings-nav" aria-label="Settings navigation">
          {searchBox}

          <nav aria-label="Settings categories" className="ui-settings-nav-list">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = t.value === tab;
              const dirty = isTabDirty(t);
              return (
                <button
                  key={t.value}
                  type="button"
                  data-active={active ? "true" : undefined}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setTab(t.value)}
                  className="ui-settings-nav-item"
                >
                  <span className="ui-settings-nav-icon">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-sm font-medium">
                      <span className="truncate">{t.label}</span>
                      {dirty && <span className="ui-settings-dirty-dot" title="Unsaved changes" />}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-fg-subtle">{t.description}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-line-subtle pt-3">
            <p className="mb-2 px-3 text-xs font-medium text-fg-subtle">Related setup</p>
            <div className="space-y-1">
              {RELATED_PAGES.map((item) => (
                <Link key={item.href} href={item.href} className="ui-setting-link-row">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-fg">{item.label}</span>
                    <span className="block truncate text-xs text-fg-subtle">{item.hint}</span>
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        </aside>

        {/* Main settings content column */}
        <div className="min-w-0">
          {tab !== "integrations" ? (
            <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
              {/* ── 1. Store & branding ──────────────────────────────────────────────────── */}
              {tab === "branding" && (
                <>
                  <section id="settings-section-store" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Store information</h2>
                        <p className="ui-settings-card-desc">Name, currency, tagline, and logos shown across the storefront.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="storeName">Store name</Label>
                        <Input id="storeName" {...register("storeName")} />
                        {errors.storeName && <p className="ui-field-error">{errors.storeName.message}</p>}
                      </div>
                      <div>
                        <Label htmlFor="currency">Currency code</Label>
                        <Input id="currency" placeholder={currencyCode} {...register("currency")} />
                      </div>
                      <div className="sm:col-span-2">
                        <Label htmlFor="tagline">Tagline</Label>
                        <Input id="tagline" placeholder="Considered clothing, made to last" {...register("tagline")} />
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-5 border-t border-line-subtle pt-5 sm:grid-cols-3">
                      <div>
                        <input type="hidden" {...register("logoUrl")} />
                        <ImageUploadField
                          label="Logo (light backgrounds)"
                          hint="Shown in the header and light sections. Transparent PNG works best."
                          value={logoUrl}
                          upload={settingsApi.uploadLogo}
                          onChange={(url) => setValue("logoUrl", url, { shouldValidate: true, shouldDirty: true })}
                          frame="logo"
                          uploadLabel="Upload logo"
                        />
                      </div>
                      <div>
                        <input type="hidden" {...register("logoOnDarkUrl")} />
                        <ImageUploadField
                          label="Logo (dark backgrounds)"
                          hint="Light-colored version for dark sections. Falls back to the light logo if empty."
                          value={logoOnDarkUrl}
                          upload={settingsApi.uploadLogo}
                          onChange={(url) => setValue("logoOnDarkUrl", url, { shouldValidate: true, shouldDirty: true })}
                          frame="logo-dark"
                          uploadLabel="Upload logo"
                        />
                      </div>
                      <div>
                        <input type="hidden" {...register("faviconUrl")} />
                        <ImageUploadField
                          label="Favicon"
                          hint="Small icon shown in the browser tab. Square images work best."
                          value={faviconUrl}
                          upload={settingsApi.uploadFavicon}
                          onChange={(url) => setValue("faviconUrl", url, { shouldValidate: true, shouldDirty: true })}
                          frame="logo"
                          uploadLabel="Upload favicon"
                        />
                      </div>
                    </div>
                    {sectionFooter("store")}
                  </section>

                  <section id="settings-section-seo" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Search engines (SEO)</h2>
                        <p className="ui-settings-card-desc">Helps Google and social previews display your store accurately.</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="googleSiteVerification">Google Search Console verification code</Label>
                        <Input id="googleSiteVerification" placeholder="abc123XYZ..." {...register("googleSiteVerification")} />
                        <p className="ui-field-hint">
                          From Search Console&rsquo;s HTML tag method — paste just the{" "}
                          <code className="rounded bg-surface-muted px-1 py-0.5 text-fg">content=&quot;...&quot;</code> value, not the full tag.
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="seoTitle">Homepage title</Label>
                        <Input id="seoTitle" maxLength={70} {...register("seoTitle")} />
                        <p className="ui-field-hint">Title shown in search results. Empty uses the store name.</p>
                        {errors.seoTitle && <p className="ui-field-error">{errors.seoTitle.message}</p>}
                      </div>
                      <div>
                        <Label htmlFor="seoDescription">Homepage description</Label>
                        <Textarea id="seoDescription" rows={2} maxLength={300} {...register("seoDescription")} />
                        <p className="ui-field-hint">Short summary under the title in search results. Empty uses the tagline.</p>
                        {errors.seoDescription && <p className="ui-field-error">{errors.seoDescription.message}</p>}
                      </div>
                      <div className="sm:max-w-md">
                        <input type="hidden" {...register("ogImageUrl")} />
                        <ImageUploadField
                          label="Social sharing image"
                          spec="shareImage"
                          hint="Pages with their own image (products, categories) use theirs. Empty uses the logo."
                          value={ogImageUrl}
                          upload={settingsApi.uploadSocialImage}
                          onChange={(url) => setValue("ogImageUrl", url, { shouldValidate: true, shouldDirty: true })}
                          uploadLabel="Upload image"
                        />
                      </div>
                    </div>
                    {sectionFooter("seo")}
                  </section>

                  <section id="settings-section-newsletter" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Newsletter</h2>
                        <p className="ui-settings-card-desc">Copy shown in the footer email sign-up block.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <Label htmlFor="newsletterHeading">Heading</Label>
                        <Input id="newsletterHeading" maxLength={80} {...register("newsletterHeading")} />
                        <p className="ui-field-hint">Empty uses &quot;Get in Touch&quot;.</p>
                      </div>
                      <div>
                        <Label htmlFor="newsletterText">Supporting line</Label>
                        <Input id="newsletterText" maxLength={300} {...register("newsletterText")} />
                        <p className="ui-field-hint">Empty uses &quot;New arrivals, offers and news — no spam, unsubscribe any time.&quot;</p>
                      </div>
                    </div>
                    {sectionFooter("newsletter")}
                  </section>
                </>
              )}

              {/* ── 2. Contact & support ─────────────────────────────────────────────────── */}
              {tab === "contact" && (
                <>
                  <section id="settings-section-contact" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Contact details</h2>
                        <p className="ui-settings-card-desc">Shown in the storefront footer, contact page, and Direct Call button.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="contactEmail">Contact email</Label>
                        <Input id="contactEmail" type="email" {...register("contactEmail")} />
                        {errors.contactEmail && <p className="ui-field-error">{errors.contactEmail.message}</p>}
                      </div>
                      <div>
                        <Label htmlFor="contactPhone">Contact phone</Label>
                        <Input id="contactPhone" {...register("contactPhone")} />
                      </div>
                    </div>
                    {sectionFooter("contact")}
                  </section>

                  <section id="settings-section-contactOptions" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Floating contact widget</h2>
                        <p className="ui-settings-card-desc">Choose which quick-contact channels appear in the storefront&rsquo;s floating button.</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="ui-setting-row">
                        <p className="text-sm font-semibold text-fg">WhatsApp</p>
                        <WhatsAppQuickConfig />
                        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-line-subtle pt-4 sm:grid-cols-2">
                          <div>
                            <Label htmlFor="whatsappLabel">Button label</Label>
                            <Input id="whatsappLabel" placeholder="WhatsApp" {...register("whatsappLabel")} />
                          </div>
                          <div>
                            <Label htmlFor="whatsappMessage">Prefilled message</Label>
                            <Input id="whatsappMessage" placeholder="Hi! I have a question about…" {...register("whatsappMessage")} />
                          </div>
                        </div>
                      </div>

                      <div className="ui-setting-row" data-enabled={callEnabled ? "true" : undefined}>
                        <div className="ui-setting-row-head">
                          <div>
                            <p className="text-sm font-semibold text-fg">Direct Call</p>
                            <p className="ui-field-hint">Uses the contact phone number set above.</p>
                          </div>
                          <Controller
                            control={control}
                            name="callEnabled"
                            render={({ field }) => (
                              <Switch
                                ref={field.ref}
                                aria-label="Enable Direct Call"
                                checked={Boolean(field.value)}
                                onChange={field.onChange}
                              />
                            )}
                          />
                        </div>
                        <div className="mt-3 sm:max-w-xs">
                          <Label htmlFor="callLabel">Button label</Label>
                          <Input id="callLabel" placeholder="Call Us" disabled={!callEnabled} {...register("callLabel")} />
                        </div>
                      </div>

                      <div className="ui-setting-row" data-enabled={liveChatEnabled ? "true" : undefined}>
                        <div className="ui-setting-row-head">
                          <div>
                            <p className="text-sm font-semibold text-fg">Live Chat (Tawk.to)</p>
                            <p className="ui-field-hint">Powered by Tawk.to — free to sign up at tawk.to.</p>
                          </div>
                          <Controller
                            control={control}
                            name="liveChatEnabled"
                            render={({ field }) => (
                              <Switch
                                ref={field.ref}
                                aria-label="Enable Live Chat"
                                checked={Boolean(field.value)}
                                onChange={field.onChange}
                              />
                            )}
                          />
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                          <div>
                            <Label htmlFor="liveChatLabel">Button label</Label>
                            <Input id="liveChatLabel" placeholder="Live Chat" disabled={!liveChatEnabled} {...register("liveChatLabel")} />
                          </div>
                          <div>
                            <Label htmlFor="tawkPropertyId">Tawk.to property ID</Label>
                            <Input id="tawkPropertyId" disabled={!liveChatEnabled} {...register("tawkPropertyId")} />
                          </div>
                          <div>
                            <Label htmlFor="tawkWidgetId">Tawk.to widget ID</Label>
                            <Input id="tawkWidgetId" disabled={!liveChatEnabled} {...register("tawkWidgetId")} />
                          </div>
                        </div>
                      </div>
                    </div>
                    {sectionFooter("contactOptions")}
                  </section>

                  <section id="settings-section-identity" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Business identity &amp; address</h2>
                        <p className="ui-settings-card-desc">
                          Registered business details shown in the footer, terms pages, and search-engine schema. Leave blank to hide.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="legalName">Legal business name</Label>
                        <Input id="legalName" {...register("legalName")} />
                      </div>
                      <div>
                        <Label htmlFor="legalJurisdiction">Governing law (country or region)</Label>
                        <Input id="legalJurisdiction" placeholder="e.g. Bangladesh" {...register("legalJurisdiction")} />
                      </div>
                      <div className="sm:col-span-2">
                        <Label htmlFor="addressLine">Street address</Label>
                        <Input id="addressLine" {...register("addressLine")} />
                      </div>
                      <div>
                        <Label htmlFor="addressCity">City</Label>
                        <Input id="addressCity" {...register("addressCity")} />
                      </div>
                      <div>
                        <Label htmlFor="addressRegion">Region / division</Label>
                        <Input id="addressRegion" {...register("addressRegion")} />
                      </div>
                      <div>
                        <Label htmlFor="addressPostalCode">Postal code</Label>
                        <Input id="addressPostalCode" {...register("addressPostalCode")} />
                      </div>
                      <div>
                        <Label htmlFor="addressCountry">Country code</Label>
                        <Input id="addressCountry" placeholder="e.g. BD" maxLength={2} {...register("addressCountry")} />
                        {errors.addressCountry && <p className="ui-field-error">{errors.addressCountry.message}</p>}
                      </div>
                      <div className="sm:col-span-2">
                        <Label htmlFor="supportHours">Support hours</Label>
                        <Input id="supportHours" placeholder="e.g. Sat–Thu, 10am–8pm" {...register("supportHours")} />
                      </div>
                    </div>
                    {sectionFooter("identity")}
                  </section>
                </>
              )}

              {/* ── 3. Orders & delivery ─────────────────────────────────────────────────── */}
              {tab === "operations" && (
                <>
                  <section id="settings-section-policy" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Store policy</h2>
                        <p className="ui-settings-card-desc">
                          Shown on product pages, Shipping &amp; Returns, FAQ, and search metadata. Blank fields make no promise.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label htmlFor="returnPolicyKind">What you offer</Label>
                        <Select id="returnPolicyKind" {...register("returnPolicyKind")}>
                          <option value="RETURN">Returns within the window below</option>
                          <option value="EXCHANGE">Exchange only — size exchange, defects at our cost, no refunds</option>
                        </Select>
                        <p className="ui-field-hint">
                          Exchange only: storefront and landing pages promise size exchange (customer pays courier) and free defect exchange, never refunds.
                        </p>
                      </div>
                      <div>
                        <Label htmlFor="returnWindowDays">Return window (days)</Label>
                        <Input id="returnWindowDays" type="number" min={1} step={1} placeholder="e.g. 7" {...register("returnWindowDays", { valueAsNumber: true })} />
                        <p className="ui-field-hint">Blank: store states no return window.</p>
                      </div>
                      <div>
                        <Label htmlFor="returnConditions">Return conditions</Label>
                        <Input id="returnConditions" placeholder="e.g. Unused items in their original packaging" {...register("returnConditions")} />
                        <p className="ui-field-hint">Read as “… can be returned or exchanged within N days of delivery.”</p>
                      </div>
                      <div>
                        <Label htmlFor="handlingDaysMin">Dispatch time — from (business days)</Label>
                        <Input id="handlingDaysMin" type="number" min={1} step={1} placeholder="e.g. 1" {...register("handlingDaysMin", { valueAsNumber: true })} />
                      </div>
                      <div>
                        <Label htmlFor="handlingDaysMax">Dispatch time — to (business days)</Label>
                        <Input id="handlingDaysMax" type="number" min={1} step={1} placeholder="e.g. 2" {...register("handlingDaysMax", { valueAsNumber: true })} />
                        {errors.handlingDaysMax && <p className="ui-field-error">{errors.handlingDaysMax.message}</p>}
                      </div>
                    </div>
                    <p className="ui-field-hint mt-4">
                      “Cash on Delivery available” follows your Cash on Delivery switch under Checkout; delivery times follow your delivery zones.
                    </p>
                    {sectionFooter("policy")}
                  </section>

                  <section id="settings-section-confirmation" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Confirmation calls</h2>
                        <p className="ui-settings-card-desc">
                          Follow-up cadence for unconfirmed orders. Orders are never auto-cancelled — they move to Escalated calls for a manager to decide.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="confirmationMaxUnreached">Unanswered calls before escalating</Label>
                        <Input id="confirmationMaxUnreached" type="number" min={1} max={10} step={1} {...register("confirmationMaxUnreached", { valueAsNumber: true })} />
                        {errors.confirmationMaxUnreached && <p className="ui-field-error">{errors.confirmationMaxUnreached.message}</p>}
                      </div>
                      <div>
                        <Label htmlFor="confirmationEscalateHours">Escalate unconfirmed order after (hours)</Label>
                        <Input id="confirmationEscalateHours" type="number" min={12} max={336} step={1} {...register("confirmationEscalateHours", { valueAsNumber: true })} />
                        {errors.confirmationEscalateHours && <p className="ui-field-error">{errors.confirmationEscalateHours.message}</p>}
                      </div>
                      <div>
                        <Label htmlFor="confirmationRetryMinutes">Retry after 1st &amp; 2nd missed call (minutes)</Label>
                        <Input id="confirmationRetryMinutes" type="number" min={15} max={720} step={5} {...register("confirmationRetryMinutes", { valueAsNumber: true })} />
                        {errors.confirmationRetryMinutes && <p className="ui-field-error">{errors.confirmationRetryMinutes.message}</p>}
                      </div>
                      <div>
                        <Label htmlFor="confirmationNextDayHour">Later retries: next day at (hour, store time)</Label>
                        <Input id="confirmationNextDayHour" type="number" min={6} max={21} step={1} {...register("confirmationNextDayHour", { valueAsNumber: true })} />
                        {errors.confirmationNextDayHour && <p className="ui-field-error">{errors.confirmationNextDayHour.message}</p>}
                      </div>
                    </div>
                    {sectionFooter("confirmation")}
                  </section>

                  <section id="settings-section-dispatch" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Dispatch &amp; courier follow-up</h2>
                        <p className="ui-settings-card-desc">
                          Booking with Steadfast moves an order to Processing. Scanning the parcel out in Dispatch scan marks it Shipped and sends the SMS.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="stuckInTransitDays">Flag stuck in transit after (days)</Label>
                        <Input id="stuckInTransitDays" type="number" min={2} max={30} step={1} {...register("stuckInTransitDays", { valueAsNumber: true })} />
                        {errors.stuckInTransitDays && <p className="ui-field-error">{errors.stuckInTransitDays.message}</p>}
                      </div>
                      <div>
                        <Label htmlFor="returnNotBackDays">Flag return overdue after (days)</Label>
                        <Input id="returnNotBackDays" type="number" min={3} max={60} step={1} {...register("returnNotBackDays", { valueAsNumber: true })} />
                        {errors.returnNotBackDays && <p className="ui-field-error">{errors.returnNotBackDays.message}</p>}
                      </div>
                    </div>
                    <p className="ui-field-hint mt-3">
                      A daily courier check surfaces these for human follow-up — it never alters orders, stock, or money automatically.
                    </p>
                    {sectionFooter("dispatch")}
                  </section>

                  <section id="settings-section-courierFees" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Delivery zones &amp; courier return fees</h2>
                        <p className="ui-settings-card-desc">Area delivery charges and estimated round-trip return fees for reporting.</p>
                      </div>
                    </div>

                    <Link href="/admin/settings/delivery-zones" className="ui-setting-link-row mb-4">
                      <div>
                        <p className="font-medium text-fg">Delivery zones &amp; shipping fees</p>
                        <p className="text-xs text-fg-muted">Set per-area delivery charges and free-delivery thresholds.</p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent">
                        Manage zones
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </Link>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="courierReturnFeeDhaka">Courier return fee — inside Dhaka ({currencyCode})</Label>
                        <Input
                          id="courierReturnFeeDhaka"
                          type="number"
                          step="0.01"
                          {...register("courierReturnFeeDhaka", { valueAsNumber: true })}
                        />
                        {errors.courierReturnFeeDhaka && <p className="ui-field-error">{errors.courierReturnFeeDhaka.message}</p>}
                      </div>
                      <div>
                        <Label htmlFor="courierReturnFeeOutsideDhaka">Courier return fee — outside Dhaka ({currencyCode})</Label>
                        <Input
                          id="courierReturnFeeOutsideDhaka"
                          type="number"
                          step="0.01"
                          {...register("courierReturnFeeOutsideDhaka", { valueAsNumber: true })}
                        />
                        {errors.courierReturnFeeOutsideDhaka && <p className="ui-field-error">{errors.courierReturnFeeOutsideDhaka.message}</p>}
                      </div>
                    </div>
                    <p className="ui-field-hint mt-3">
                      Estimated round-trip cost when a booked order is cancelled or partially returned — used for the dashboard&rsquo;s cancellation-loss estimate.
                    </p>
                    {sectionFooter("courierFees")}
                  </section>
                </>
              )}

              {/* ── 4. Checkout, tax & rewards (pane=shipping kept for deep links & E2E) ── */}
              {tab === "shipping" && (
                <>
                  <section id="settings-section-payments" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Payment methods at checkout</h2>
                        <p className="ui-settings-card-desc">
                          Toggle Cash on Delivery or online payment anytime — at least one method must remain active.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="ui-setting-row" data-enabled={codEnabled ? "true" : undefined}>
                        <div className="ui-setting-row-head">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-fg">Cash on Delivery</p>
                              <Badge variant={codEnabled ? "success" : "neutral"}>{codEnabled ? "Active" : "Off"}</Badge>
                            </div>
                            <p className="ui-field-hint">Customers pay in cash when the parcel arrives.</p>
                          </div>
                          <Controller
                            control={control}
                            name="codEnabled"
                            render={({ field }) => (
                              <Switch
                                ref={field.ref}
                                aria-label="Cash on Delivery"
                                checked={Boolean(field.value)}
                                onChange={field.onChange}
                                disabled={Boolean(codEnabled && isLastPaymentMethodEnabled)}
                              />
                            )}
                          />
                        </div>
                      </div>

                      <div className="ui-setting-row" data-enabled={onlinePaymentEnabled ? "true" : undefined}>
                        <div className="ui-setting-row-head">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-fg">Online Payment (SSLCommerz)</p>
                              <Badge variant={onlinePaymentEnabled ? "success" : gateways.loaded && !gateways.payments.SSLCOMMERZ ? "warning" : "neutral"}>
                                {onlinePaymentEnabled ? "Active" : gateways.loaded && !gateways.payments.SSLCOMMERZ ? "Not connected" : "Off"}
                              </Badge>
                            </div>
                            <p className="ui-field-hint">bKash, Nagad &amp; Card via SSLCommerz.</p>
                            {gateways.loaded && !gateways.payments.SSLCOMMERZ && <IntegrationsHint />}
                          </div>
                          <Controller
                            control={control}
                            name="onlinePaymentEnabled"
                            render={({ field }) => (
                              <Switch
                                ref={field.ref}
                                aria-label="Online Payment (SSLCommerz)"
                                checked={Boolean(field.value)}
                                onChange={field.onChange}
                                disabled={Boolean((onlinePaymentEnabled && isLastPaymentMethodEnabled) || (!onlinePaymentEnabled && !gateways.payments.SSLCOMMERZ))}
                              />
                            )}
                          />
                        </div>
                      </div>

                      <div className="ui-setting-row" data-enabled={epsPaymentEnabled ? "true" : undefined}>
                        <div className="ui-setting-row-head">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-fg">Online Payment (EPS-PG)</p>
                              <Badge variant={epsPaymentEnabled ? "success" : gateways.loaded && !gateways.payments.EPS_PG ? "warning" : "neutral"}>
                                {epsPaymentEnabled ? "Active" : gateways.loaded && !gateways.payments.EPS_PG ? "Not connected" : "Off"}
                              </Badge>
                            </div>
                            <p className="ui-field-hint">bKash, Nagad &amp; Card via EPS.</p>
                            {gateways.loaded && !gateways.payments.EPS_PG && <IntegrationsHint />}
                          </div>
                          <Controller
                            control={control}
                            name="epsPaymentEnabled"
                            render={({ field }) => (
                              <Switch
                                ref={field.ref}
                                aria-label="Online Payment (EPS-PG)"
                                checked={Boolean(field.value)}
                                onChange={field.onChange}
                                disabled={Boolean((epsPaymentEnabled && isLastPaymentMethodEnabled) || (!epsPaymentEnabled && !gateways.payments.EPS_PG))}
                              />
                            )}
                          />
                        </div>
                      </div>

                      {!codEnabled && !onlinePaymentEnabled && !epsPaymentEnabled && (
                        <p className="ui-field-error">At least one payment method must stay enabled.</p>
                      )}
                    </div>
                    {sectionFooter("payments")}
                  </section>

                  <section id="settings-section-tax" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Tax &amp; VAT</h2>
                        <p className="ui-settings-card-desc">Applied live at checkout by the central tax engine.</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="ui-setting-row" data-enabled={taxEnabled ? "true" : undefined}>
                        <div className="ui-setting-row-head">
                          <div>
                            <p className="text-sm font-semibold text-fg">Enable tax on new products by default</p>
                            <p className="ui-field-hint">Applies the default VAT rate below unless a product overrides it.</p>
                          </div>
                          <Controller
                            control={control}
                            name="taxEnabled"
                            render={({ field }) => (
                              <Switch
                                ref={field.ref}
                                aria-label="Enable tax on new products by default"
                                checked={Boolean(field.value)}
                                onChange={field.onChange}
                              />
                            )}
                          />
                        </div>

                        <div className="mt-4 grid grid-cols-1 items-end gap-4 border-t border-line-subtle pt-4 sm:grid-cols-2">
                          <div>
                            <Label htmlFor="defaultTaxRate">Default tax rate (%)</Label>
                            <Input
                              id="defaultTaxRate"
                              type="number"
                              step="0.01"
                              disabled={!taxEnabled}
                              {...register("defaultTaxRate", { valueAsNumber: true })}
                            />
                            {errors.defaultTaxRate && <p className="ui-field-error">{errors.defaultTaxRate.message}</p>}
                          </div>

                          {/* D10: stored on the central tax config (TaxSetting), applied by the tax engine — shipping is VAT-inclusive. */}
                          <div className="flex items-center justify-between gap-3 rounded-lg border border-line-subtle bg-surface px-3.5 py-2.5">
                            <span className="text-sm text-fg">Shipping fee includes VAT</span>
                            <Controller
                              control={control}
                              name="shippingTaxable"
                              render={({ field }) => (
                                <Switch
                                  ref={field.ref}
                                  aria-label="Shipping fee includes VAT"
                                  checked={Boolean(field.value)}
                                  onChange={field.onChange}
                                  disabled={!taxEnabled}
                                />
                              )}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    {sectionFooter("tax")}
                  </section>

                  <section id="settings-section-rewards" className="ui-settings-card">
                    <div className="ui-settings-card-head">
                      <div>
                        <h2 className="ui-settings-card-title">Customer rewards</h2>
                        <p className="ui-settings-card-desc">Loyalty points earned automatically on completed orders.</p>
                      </div>
                    </div>

                    <div className="sm:max-w-sm">
                      <Label htmlFor="rewardPointsPerCurrency">Reward points per 1 {currencyCode} spent</Label>
                      <Input
                        id="rewardPointsPerCurrency"
                        type="number"
                        step="0.0001"
                        placeholder="0 disables rewards"
                        {...register("rewardPointsPerCurrency", { valueAsNumber: true })}
                      />
                      <p className="ui-field-hint">Set to 0 to turn off customer reward points.</p>
                      {errors.rewardPointsPerCurrency && <p className="ui-field-error">{errors.rewardPointsPerCurrency.message}</p>}
                    </div>
                    {sectionFooter("rewards")}
                  </section>
                </>
              )}
            </form>
          ) : (
            /* Its own forms per integration — outside the settings form (forms can't nest). */
            <div id="settings-section-integrations">
              <IntegrationsPane />
            </div>
          )}

          {/* Mobile & tablet related setup shortcuts (desktop shows these in the sticky rail) */}
          <section className="mt-6 border-t border-line-subtle pt-5 lg:hidden">
            <p className="mb-2.5 text-xs font-medium text-fg-subtle">Related setup</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {RELATED_PAGES.map((item) => (
                <Link key={item.href} href={item.href} className="ui-setting-link-row">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{item.label}</span>
                    <span className="block truncate text-xs text-fg-subtle">{item.hint}</span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
