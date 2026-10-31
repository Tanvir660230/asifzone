"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, Clock, LayoutGrid, Mic, Search, SearchX, X, XCircle } from "lucide-react";
import type { SearchSuggestionProduct, SearchSuggestions } from "@clothing-brand/shared";
import { fetchPopularSearches, fetchSearchSuggestions } from "@/lib/api/storefront";
import { addRecentSearch, clearRecentSearches, getRecentSearches, removeRecentSearch } from "@/lib/recent-searches";
import { navHref, type NavNode } from "@/lib/nav-links";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useSearchOverlayStore } from "@/store/search-overlay";
import { Money } from "@/components/ui/money";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/image-url";

interface SpeechRecognitionResultEvent {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** One selectable row. Rows are a single list for the keyboard (↑/↓ walk all of them), grouped into sections on screen. */
type Row =
  | { kind: "recent" | "popular" | "prediction" | "did-you-mean"; text: string }
  | { kind: "category"; name: string; slug: string }
  | { kind: "product"; product: SearchSuggestionProduct }
  | { kind: "see-all"; text: string };

interface Section {
  key: string;
  title?: string;
  note?: string;
  action?: { label: string; onClick: () => void };
  rows: { row: Row; index: number }[];
}

/** The typed part stays quiet and the completion carries the weight, so the eye lands on what's new. */
function Completion({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <span className="truncate text-fg">{text}</span>;
  return (
    <span className="truncate font-medium text-fg">
      {text.slice(0, at)}
      <span className="font-normal text-fg-muted">{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </span>
  );
}

/** `categories`: the store's top categories, offered as a way in when there is nothing to suggest yet (a new store with
 * no searches, a shopper with no history) instead of an empty sheet. */
export function SearchOverlay({ categories = [] }: { categories?: NavNode[] }) {
  const router = useRouter();
  const { isOpen, open: openStore, close: closeStore } = useSearchOverlayStore();
  const listId = useId();

  const [query, setQuery] = useState("");
  // The last answer and the query it answers: kept on screen while the next one loads, so the list never blanks mid-typing.
  const [result, setResult] = useState<{ query: string; data: SearchSuggestions } | null>(null);
  const [failed, setFailed] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [popularSearches, setPopularSearches] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [langBn, setLangBn] = useState(true);
  const [listening, setListening] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const selectPrefill = useRef(false);
  // Tab-trap + scroll-lock + focus-restore-on-close + Escape; arrow keys move through the list from the input itself.
  const panelRef = useFocusTrap<HTMLDivElement>({ active: isOpen, onEscape: handleEscape });

  const trimmedQuery = query.trim();
  const typing = trimmedQuery.length > 0;
  const debouncedQuery = useDebouncedValue(trimmedQuery, 200);
  const suggestions = typing ? result?.data ?? null : null;
  const stale = typing && result?.query !== trimmedQuery;

  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  // "/" or Ctrl/⌘+K opens search from anywhere in the store (not while the shopper is typing in a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // `!e.key`: Chrome's autofill fires keydown events with no key — it threw here on every autofilled checkout field.
      if (isOpen || e.defaultPrevented || !e.key) return;
      const target = e.target as HTMLElement | null;
      const inField = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if ((e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !inField && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        openStore();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, openStore]);

  useEffect(() => {
    if (!isOpen) return;
    // Opened from a results page: start from that search, ready to refine it.
    const current = window.location.pathname === "/search" ? new URLSearchParams(window.location.search).get("q") ?? "" : "";
    setQuery(current);
    setResult(null);
    setFailed(false);
    setActiveIndex(-1);
    setRecentSearches(getRecentSearches());
    fetchPopularSearches()
      .then((data) => setPopularSearches(data.queries))
      .catch(() => setPopularSearches([]));
    // Focus at once (a delay drops the first letter of a fast typist); the prefilled search is selected once it renders.
    inputRef.current?.focus();
    selectPrefill.current = current.length > 0;
  }, [isOpen]);

  // Typing replaces the prefilled search; the arrow keys keep it to refine.
  useEffect(() => {
    if (!selectPrefill.current || !query) return;
    selectPrefill.current = false;
    inputRef.current?.select();
  }, [query]);

  useEffect(() => {
    if (!isOpen || !debouncedQuery) return;
    let cancelled = false;
    fetchSearchSuggestions(debouncedQuery)
      .then((data) => {
        if (cancelled) return;
        setResult({ query: debouncedQuery, data });
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, isOpen]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [trimmedQuery, result, recentSearches, popularSearches]);

  const sections: Section[] = useMemo(() => {
    let index = 0;
    const take = (rows: Row[]) => rows.map((row) => ({ row, index: index++ }));
    if (!typing) {
      return [
        {
          key: "recent",
          title: "Recent",
          action: {
            label: "Clear",
            onClick: () => {
              clearRecentSearches();
              setRecentSearches([]);
            },
          },
          rows: take(recentSearches.slice(0, 5).map((text): Row => ({ kind: "recent", text }))),
        },
        {
          key: "popular",
          title: "Popular searches",
          rows: take(
            popularSearches
              .filter((text) => !recentSearches.slice(0, 5).some((r) => r.toLowerCase() === text.toLowerCase()))
              .slice(0, 6)
              .map((text): Row => ({ kind: "popular", text })),
          ),
        },
      ].filter((s) => s.rows.length > 0);
    }
    if (!suggestions) return [];
    const related = suggestions.matchQuality === "related";
    const nothing = suggestions.products.length === 0 && suggestions.categories.length === 0 && suggestions.predictions.length === 0;
    return [
      { key: "predictions", rows: take(suggestions.predictions.map((text): Row => ({ kind: "prediction", text }))) },
      ...(nothing && suggestions.didYouMean
        ? [{ key: "did-you-mean", rows: take([{ kind: "did-you-mean", text: suggestions.didYouMean }]) }]
        : []),
      { key: "categories", title: "Categories", rows: take(suggestions.categories.map((c): Row => ({ kind: "category", ...c }))) },
      {
        key: "products",
        title: related ? "Related products" : "Products",
        note: related ? `No exact matches for “${trimmedQuery}”` : undefined,
        rows: take(suggestions.products.map((product): Row => ({ kind: "product", product }))),
      },
      { key: "see-all", rows: take([{ kind: "see-all", text: trimmedQuery }]) },
    ].filter((s) => s.rows.length > 0);
  }, [typing, recentSearches, popularSearches, suggestions, trimmedQuery]);

  const rows = useMemo(() => sections.flatMap((s) => s.rows.map((r) => r.row)), [sections]);
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    if (activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionId is derived from the stable listId
  }, [activeIndex]);

  function close() {
    recognitionRef.current?.stop();
    setListening(false);
    closeStore();
  }

  function clearQuery() {
    setQuery("");
    inputRef.current?.focus();
  }

  function go(href: string) {
    closeStore();
    router.push(href);
  }

  function submitSearch(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    addRecentSearch(trimmed);
    go(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  function hrefFor(row: Row): string | null {
    if (row.kind === "product") return `/product/${row.product.slug}`;
    if (row.kind === "category") return `/category/${row.slug}`;
    return null;
  }

  function selectRow(row: Row) {
    const href = hrefFor(row);
    if (href) {
      if (trimmedQuery) addRecentSearch(trimmedQuery);
      go(href);
    } else if (row.kind !== "product" && row.kind !== "category") {
      submitSearch(row.text);
    }
  }

  function prefetchRow(row: Row) {
    const href = hrefFor(row);
    if (href) router.prefetch(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      const next = e.key === "ArrowDown" ? (activeIndex + 1) % rows.length : activeIndex <= 0 ? rows.length - 1 : activeIndex - 1;
      setActiveIndex(next);
      prefetchRow(rows[next]!);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = activeIndex >= 0 ? rows[activeIndex] : undefined;
      if (row) selectRow(row);
      else submitSearch(trimmedQuery);
    }
  }

  /** Escape empties the field first (as on iOS), and closes search from an empty field. */
  function handleEscape() {
    if (query) clearQuery();
    else close();
  }

  function removeRecent(text: string) {
    removeRecentSearch(text);
    setRecentSearches((prev) => prev.filter((t) => t !== text));
    inputRef.current?.focus();
  }

  function startVoiceSearch() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = langBn ? "bn-BD" : "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        setQuery(transcript);
        submitSearch(transcript);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopVoiceSearch() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  if (!isOpen) return null;

  const loadingFirst = typing && !suggestions && !failed;
  const showList = sections.length > 0;

  return createPortal(
    <div className="fixed inset-x-0 bottom-[var(--dock-offset)] top-0 z-overlay sm:px-4 sm:pt-[12vh]">
      <div className="ui-overlay absolute inset-0 hidden animate-fade-in sm:block" onClick={close} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        tabIndex={-1}
        className="relative mx-auto flex h-full w-full animate-fade-in flex-col bg-surface outline-none sm:h-auto sm:max-h-[min(38rem,78vh)] sm:max-w-[40rem] sm:animate-modal-in sm:overflow-hidden sm:rounded-2xl sm:shadow-floatLg"
      >
        {/* The field — iOS-style filled search bar, with Cancel beside it on phones. */}
        <div className="flex shrink-0 items-center gap-3 border-b border-line-subtle px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-3 sm:py-3">
          <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg bg-ink-100/70 pl-3 pr-1.5 transition-shadow duration-fast ease-smooth focus-within:ring-2 focus-within:ring-accent/15 sm:h-12">
            <Search size={18} className={cn("shrink-0 text-fg-subtle transition-opacity duration-fast", stale && "animate-pulse")} aria-hidden />
            <input
              ref={inputRef}
              autoFocus
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={listening ? "Listening…" : "Search products"}
              aria-label="Search products"
              role="combobox"
              aria-expanded={showList}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-fg outline-none placeholder:text-fg-subtle sm:text-base [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={clearQuery}
                aria-label="Clear search"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-subtle transition-colors duration-fast ease-smooth hover:text-fg"
              >
                <XCircle size={17} />
              </button>
            ) : (
              speechSupported && (
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => setLangBn((v) => !v)}
                    aria-label={`Voice search language: ${langBn ? "Bangla" : "English"}. Switch`}
                    className="h-8 rounded-md px-2 text-xs font-medium text-fg-muted transition-colors duration-fast ease-smooth hover:bg-ink-200/60 hover:text-fg"
                  >
                    {langBn ? "বাংলা" : "EN"}
                  </button>
                  <button
                    type="button"
                    onClick={listening ? stopVoiceSearch : startVoiceSearch}
                    aria-label={listening ? "Stop voice search" : "Search by voice"}
                    aria-pressed={listening}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-fast ease-smooth",
                      listening ? "animate-pulse bg-danger-500 text-white" : "text-fg-muted hover:bg-ink-200/60 hover:text-fg",
                    )}
                  >
                    <Mic size={16} />
                  </button>
                </div>
              )
            )}
          </div>
          <button
            type="button"
            onClick={close}
            className="shrink-0 py-2 text-[15px] font-medium text-fg transition-opacity duration-fast hover:opacity-70 sm:hidden"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors duration-fast ease-smooth hover:bg-ink-100 hover:text-fg sm:flex"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {loadingFirst ? (
            <SuggestionSkeleton />
          ) : typing && failed && !suggestions ? (
            <div className="px-5 py-10 text-center">
              <p className="text-[15px] text-fg">Suggestions aren&rsquo;t loading right now.</p>
              <button
                type="button"
                onClick={() => submitSearch(trimmedQuery)}
                className="mt-3 text-sm font-medium text-fg underline underline-offset-4 transition-opacity hover:opacity-70"
              >
                Search for &ldquo;{trimmedQuery}&rdquo; anyway
              </button>
            </div>
          ) : !showList ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <Search size={28} className="text-ink-300" aria-hidden />
              <p className="mt-3 text-[15px] text-fg-muted">Search by product, category or colour.</p>
              {categories.length > 0 && (
                <nav aria-label="Browse categories" className="mt-8 w-full text-left">
                  <p className="px-1 pb-2 text-[13px] font-semibold text-fg">Browse</p>
                  <ul className="flex flex-wrap gap-2">
                    {categories.slice(0, 10).map((cat) => (
                      <li key={cat.id}>
                        <Link
                          href={navHref(cat)}
                          onClick={close}
                          className="inline-flex h-10 items-center rounded-full bg-ink-100/70 px-4 text-[15px] text-fg transition-colors duration-fast ease-smooth hover:bg-ink-200/70"
                        >
                          {cat.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </div>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label="Search suggestions"
              className={cn("pb-2 transition-opacity duration-base ease-smooth", stale && "opacity-60")}
            >
              {sections.map((section) => (
                <li key={section.key} role="presentation" className="pt-2 first:pt-1">
                  {section.title && (
                    <div className="flex items-baseline justify-between px-5 pb-1 pt-3">
                      <span className="text-[13px] font-semibold text-fg">{section.title}</span>
                      {section.action && (
                        <button
                          type="button"
                          onClick={section.action.onClick}
                          className="text-[13px] text-fg-muted transition-colors duration-fast hover:text-fg"
                        >
                          {section.action.label}
                        </button>
                      )}
                    </div>
                  )}
                  {section.note && <p className="px-5 pb-1.5 text-[13px] text-fg-muted">{section.note}</p>}
                  <ul role="group" aria-label={section.title}>
                    {section.rows.map(({ row, index }) => (
                      <li key={index} role="presentation" className="group relative px-2">
                        <div
                          id={optionId(index)}
                          role="option"
                          aria-selected={activeIndex === index}
                          onPointerMove={() => activeIndex !== index && setActiveIndex(index)}
                          onPointerEnter={() => prefetchRow(row)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectRow(row)}
                          className={cn(
                            "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition-colors duration-instant",
                            activeIndex === index && "bg-ink-100/70",
                            row.kind === "recent" && "pr-11",
                          )}
                        >
                          <RowContent row={row} query={trimmedQuery} />
                        </div>
                        {row.kind === "recent" && (
                          <button
                            type="button"
                            onClick={() => removeRecent(row.text)}
                            aria-label={`Remove “${row.text}” from recent searches`}
                            className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-fg-subtle transition-[opacity,color] duration-fast hover:text-fg focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            <X size={15} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="hidden shrink-0 items-center gap-5 border-t border-line-subtle px-5 py-2.5 text-xs text-fg-subtle sm:flex">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> to open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd> to close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface px-1 font-sans text-xs text-fg-muted">{children}</kbd>;
}

function RowIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex w-5 shrink-0 justify-center text-fg-subtle" aria-hidden>{children}</span>;
}

function RowContent({ row, query }: { row: Row; query: string }) {
  switch (row.kind) {
    case "recent":
      return (
        <>
          <RowIcon><Clock size={16} /></RowIcon>
          <span className="truncate text-fg">{row.text}</span>
        </>
      );
    case "popular":
    case "prediction":
      return (
        <>
          <RowIcon><Search size={16} /></RowIcon>
          <Completion text={row.text} query={row.kind === "prediction" ? query : ""} />
        </>
      );
    case "did-you-mean":
      return (
        <>
          <RowIcon><SearchX size={16} /></RowIcon>
          <span className="truncate text-fg-muted">
            No results. Did you mean <span className="font-medium text-fg">&ldquo;{row.text}&rdquo;</span>?
          </span>
        </>
      );
    case "category":
      return (
        <>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-ink-100/70 text-fg-muted" aria-hidden>
            <LayoutGrid size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-fg">{row.name}</span>
            <span className="block text-[13px] text-fg-muted">Category</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-ink-300" aria-hidden />
        </>
      );
    case "product":
      return <SearchSuggestionProductContent product={row.product} />;
    case "see-all":
      return (
        <>
          <RowIcon><ArrowRight size={16} className="text-fg" /></RowIcon>
          <span className="truncate font-medium text-fg">Show all results for &ldquo;{row.text}&rdquo;</span>
        </>
      );
  }
}

function SuggestionSkeleton() {
  return (
    <div className="space-y-1 px-2 py-3" aria-busy="true" aria-label="Loading suggestions">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <div className="ui-skeleton h-12 w-12 shrink-0 rounded-[10px]" />
          <div className="flex-1 space-y-2">
            <div className="ui-skeleton h-3.5" style={{ width: `${70 - i * 12}%` }} />
            <div className="ui-skeleton h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** One product row in the instant-search list (the row around it belongs to the overlay). Exported so the admin
 * wizard's "Search result" preview shows the product exactly as a shopper typing its name would see it. */
export function SearchSuggestionProductContent({ product }: { product: SearchSuggestionProduct; highlighted?: boolean }) {
  return (
    <>
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- small suggestion thumbnail, not worth next/image here
        <img
          src={resolveImageUrl(product.imageUrl)}
          alt=""
          loading="lazy"
          className="h-12 w-12 shrink-0 rounded-[10px] bg-ink-100 object-cover"
        />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded-[10px] bg-ink-100" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] text-fg">{product.name}</p>
        <p className="text-[13px] tabular-nums text-fg-muted">
          <Money value={product.price} />
        </p>
      </div>
    </>
  );
}
