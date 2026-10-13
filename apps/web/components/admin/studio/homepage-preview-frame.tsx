"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  Banner,
  FlashSale,
  PaymentMethodOption,
  Product,
  ProductCarouselConfig,
  SocialLink,
  StorefrontDesign,
  StoreSettings,
  StudioSection,
} from "@clothing-brand/shared";
import { AnnouncementBar } from "@/components/storefront/announcement-bar";
import { StoreFooter, StoreHeader } from "@/components/storefront/store-chrome";
import { DESIGN_STYLE_ELEMENT_ID, designCss } from "@/lib/design-css";
import { publicRuntimeConfig } from "@/lib/runtime-config";
import { resolveThemeId } from "@/lib/theme";
import { HomeSection, type HomeSectionData } from "@/components/storefront/home/home-section";
import type { CategoryTreeNode } from "@/lib/api/storefront";
import { featuredReviewsQueries, loadFeaturedReviews, resolveProductCarouselProducts } from "@/lib/homepage-data";
import type { StoreLayout } from "@/lib/theme-layout";
import {
  isStudioMessage,
  type StudioReadyMessage,
  type StudioRenderedMessage,
  type StudioScrollToMessage,
  type StudioSelectMessage,
  type StudioUpdateMessage,
} from "@/lib/studio/preview-protocol";
import { SECTION_META } from "./section-meta";
import { DESIGN_META, designGroupOf } from "./design-meta";

interface HomepagePreviewFrameProps {
  settings: StoreSettings;
  socialLinks: SocialLink[];
  paymentMethods: PaymentMethodOption[];
  tree: CategoryTreeNode[];
  banners: Banner[];
  flashSale: FlashSale | null;
  layout: StoreLayout;
}

function post(message: StudioReadyMessage | StudioSelectMessage | StudioRenderedMessage) {
  window.parent.postMessage(message, window.location.origin);
}

function sectionElement(id: string) {
  const el = document.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(id)}"]`);
  // The chrome (announcement, header, footer) is tagged on a `display: contents` wrapper, which has no box of its own.
  return el?.classList.contains("contents") ? ((el.firstElementChild as HTMLElement | null) ?? null) : el;
}

function scheduleNote(section: StudioSection, now: number) {
  if (section.startsAt && new Date(section.startsAt).getTime() > now) return "Scheduled — not live yet";
  if (section.endsAt && new Date(section.endsAt).getTime() < now) return "Schedule ended — not shown";
  return null;
}

/**
 * Runs inside the Storefront Studio's preview iframe (same origin, same admin session). Renders nothing of its own: the
 * Studio posts the draft, and this renders it with the real homepage sections at the iframe's real width. Clicking a
 * section selects it in the Studio; links, buttons and forms never act (the preview must not touch the admin's real
 * storefront session or navigate away).
 */
export function HomepagePreviewFrame({ settings, socialLinks, paymentMethods, tree, banners, flashSale, layout }: HomepagePreviewFrameProps) {
  const { storeName, tagline } = settings;
  const [state, setState] = useState<{ sections: StudioSection[]; design: StorefrontDesign; selectedId: string | null } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      if (isStudioMessage<StudioUpdateMessage>(e.data, "studio:update")) setState({ sections: e.data.sections, design: e.data.design, selectedId: e.data.selectedId });
      if (isStudioMessage<StudioScrollToMessage>(e.data, "studio:scroll-to")) {
        sectionElement(e.data.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    window.addEventListener("message", onMessage);
    post({ type: "studio:ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Every click selects the section under it; nothing in the preview navigates, submits or adds to the bag.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      const id = (e.target as Element | null)?.closest<HTMLElement>("[data-section-id]")?.dataset.sectionId;
      if (id) post({ type: "studio:select", id });
    }
    function onSubmit(e: Event) {
      e.preventDefault();
    }
    function onOver(e: MouseEvent) {
      setHoveredId((e.target as Element | null)?.closest<HTMLElement>("[data-section-id]")?.dataset.sectionId ?? null);
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    const onLeave = () => setHoveredId(null);
    document.addEventListener("mouseover", onOver);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("mouseover", onOver);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const sections = useMemo(() => state?.sections ?? [], [state]);
  const selectedId = state?.selectedId ?? null;
  // Switched-off sections stay out of the page, except the one being edited (shown dimmed, so it can still be seen).
  const visible = useMemo(() => sections.filter((s) => s.isActive || s.id === selectedId), [sections, selectedId]);

  const carousels = visible.filter((s) => s.type === "PRODUCT_CAROUSEL");
  const carouselResults = useQueries({
    queries: carousels.map((s) => {
      const config = s.config as ProductCarouselConfig;
      return {
        queryKey: ["studio-preview-carousel", config.source ?? "featured", config.category ?? null, config.itemCount ?? 8],
        queryFn: () => resolveProductCarouselProducts({ ...config, source: config.source ?? "featured", itemCount: config.itemCount ?? 8 }),
        staleTime: 60_000,
        enabled: config.source !== "category" || Boolean(config.category),
      };
    }),
  });
  const reviewQueries = featuredReviewsQueries(visible);
  const { data: reviews } = useQuery({
    queryKey: ["studio-preview-reviews", reviewQueries],
    queryFn: () => loadFeaturedReviews(visible),
    enabled: reviewQueries.length > 0,
    staleTime: 60_000,
  });

  const data: HomeSectionData = {
    storeName,
    tagline,
    tree,
    banners,
    flashSale,
    carouselProducts: new Map<string, Product[]>(carousels.map((s, i) => [s.id, carouselResults[i]?.data?.items ?? []])),
    reviews: reviews ?? [],
  };

  // Tell the Studio which switched-on sections take no space at this width (hidden on this device, or nothing to show) —
  // after every render, and when the frame is resized to another device (no re-render happens then).
  const carouselsLoaded = carouselResults.every((r) => !r.isLoading);
  const reportRef = useRef<() => void>(() => {});
  reportRef.current = () => {
    if (!state || !carouselsLoaded) return;
    const emptyIds = sections.filter((s) => s.isActive && !(sectionElement(s.id)?.offsetHeight ?? 0)).map((s) => s.id);
    post({ type: "studio:rendered", emptyIds });
  };
  useEffect(() => {
    const t = setTimeout(() => reportRef.current(), 150);
    return () => clearTimeout(t);
  });
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => reportRef.current(), 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // The draft's theme choices replace the published ones in the page's design stylesheet (same tokens, same selectors).
  const draftDesign = state?.design;
  useEffect(() => {
    const el = document.getElementById(DESIGN_STYLE_ELEMENT_ID);
    if (el && draftDesign) el.textContent = designCss(resolveThemeId(publicRuntimeConfig().theme), draftDesign.theme);
  }, [draftDesign]);

  // The header, footer and announcement bar render from the draft design too, each tagged so a click selects it.
  const draftSettings: StoreSettings = { ...settings, storefrontDesign: draftDesign ?? settings.storefrontDesign };
  const chrome = (body: React.ReactNode) => (
    <div className="flex min-h-screen flex-col">
      <div data-section-id="design:announcement" className="contents">
        <AnnouncementBar announcement={draftSettings.storefrontDesign?.announcement} />
      </div>
      <div data-section-id="design:header" className="contents">
        <StoreHeader categories={tree} settings={draftSettings} />
      </div>
      <main className="flex-1">{body}</main>
      <div data-section-id="design:footer" className="contents">
        <StoreFooter categories={tree} settings={draftSettings} socialLinks={socialLinks} paymentMethods={paymentMethods} />
      </div>
    </div>
  );

  if (!state) return chrome(<p className="mx-auto max-w-7xl px-4 py-24 text-sm text-fg-muted">Loading preview…</p>);
  const now = Date.now();
  const overlay = (
    <SelectionOverlay
      sections={sections}
      hoveredId={hoveredId}
      selectedId={selectedId}
      noteFor={(s) => (!s.isActive ? "Switched off — not on the live page" : scheduleNote(s, now))}
    />
  );
  if (visible.length === 0) {
    return chrome(
      <>
        <p className="mx-auto max-w-7xl px-4 py-24 text-sm text-fg-muted">Every section is switched off — the homepage would show only the header and footer.</p>
        {overlay}
      </>,
    );
  }

  return chrome(
    <>
      {visible.map((section) => (
        <Fragment key={section.id}>
          {section.isActive ? (
            <HomeSection section={section} data={data} layout={layout} />
          ) : (
            <div className="opacity-50">
              <HomeSection section={section} data={data} layout={layout} />
            </div>
          )}
        </Fragment>
      ))}
      {overlay}
    </>,
  );
}

interface Box {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Outlines the hovered and the selected section and labels them, drawn over the page (never inside the sections, so
 * their layout is exactly the live one). Re-measured on scroll, resize and whenever the page's height changes. */
function SelectionOverlay({
  sections,
  hoveredId,
  selectedId,
  noteFor,
}: {
  sections: StudioSection[];
  hoveredId: string | null;
  selectedId: string | null;
  noteFor: (section: StudioSection) => string | null;
}) {
  const [boxes, setBoxes] = useState<{ hovered: Box | null; selected: Box | null }>({ hovered: null, selected: null });

  const measure = useCallback(() => {
    const box = (id: string | null): Box | null => {
      const el = id ? sectionElement(id) : null;
      if (!el || !el.offsetHeight) return null;
      const r = el.getBoundingClientRect();
      return { id: id!, top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
    };
    setBoxes({ hovered: hoveredId !== selectedId ? box(hoveredId) : null, selected: box(selectedId) });
  }, [hoveredId, selectedId]);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, sections]);

  const label = (id: string) => {
    const group = designGroupOf(id);
    if (group) return { name: DESIGN_META[group].label, note: null };
    const section = sections.find((s) => s.id === id);
    if (!section) return null;
    return { name: SECTION_META[section.type].label, note: noteFor(section) };
  };

  return (
    <div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-overlay">
      {boxes.hovered && (
        <div
          className="absolute rounded-sm border border-dashed border-info-500"
          style={{ top: boxes.hovered.top, left: boxes.hovered.left, width: boxes.hovered.width, height: boxes.hovered.height }}
        >
          <span className="absolute left-2 top-2 rounded bg-info-500 px-2 py-0.5 text-xs font-medium text-info-50 shadow-sm">
            {label(boxes.hovered.id)?.name}
          </span>
        </div>
      )}
      {boxes.selected && (
        <div
          className="absolute rounded-sm border-2 border-info-600"
          style={{ top: boxes.selected.top, left: boxes.selected.left, width: boxes.selected.width, height: boxes.selected.height }}
        >
          <span className="absolute left-2 top-2 flex items-center gap-2 rounded bg-info-600 px-2 py-0.5 text-xs font-medium text-info-50 shadow-sm">
            {label(boxes.selected.id)?.name}
            {label(boxes.selected.id)?.note && <span className="font-normal opacity-90">· {label(boxes.selected.id)?.note}</span>}
          </span>
        </div>
      )}
    </div>
  );
}
