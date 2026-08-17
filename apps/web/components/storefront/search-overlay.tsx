"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Clock, Loader2, Mic, Search, TrendingUp, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SearchSuggestionProduct, SearchSuggestions } from "@clothing-brand/shared";
import { fetchPopularSearches, fetchSearchSuggestions } from "@/lib/api/storefront";
import { addRecentSearch, clearRecentSearches, getRecentSearches, removeRecentSearch } from "@/lib/recent-searches";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useSearchOverlayStore } from "@/store/search-overlay";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

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

type FlatItem =
  | { type: "recent" | "popular" | "prediction"; text: string }
  | { type: "product"; product: SearchSuggestionProduct }
  | { type: "see-all"; text: string };

function SuggestionChip({
  text,
  icon: Icon,
  highlighted,
  onClick,
  onRemove,
}: {
  text: string;
  icon?: LucideIcon;
  highlighted: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cn(
        "group flex items-center rounded-full border border-ink-200 pl-3 pr-1 py-1.5 text-sm text-ink-700 transition-colors duration-150 ease-smooth hover:border-ink-400",
        highlighted && "border-ink-900",
        !onRemove && "pr-3",
      )}
    >
      <button type="button" onClick={onClick} className="flex items-center gap-1.5">
        {Icon && <Icon size={13} className="shrink-0 text-ink-400" />}
        {text}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove "${text}" from recent searches`}
          className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-300 opacity-0 transition-opacity duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-700 group-hover:opacity-100"
        >
          <X size={11} />
        </button>
      )}
    </span>
  );
}

function SectionHeading({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
      <Icon size={13} />
      {children}
    </h3>
  );
}

export function SearchOverlay() {
  const router = useRouter();
  const { isOpen, close: closeStore } = useSearchOverlayStore();

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestions | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [popularSearches, setPopularSearches] = useState<string[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [langBn, setLangBn] = useState(true);
  const [listening, setListening] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Tab-trap + scroll-lock + focus-restore-on-close — this overlay previously only handled Escape
  // itself (see the effect below); a keyboard user could Tab straight out of it into the page
  // behind the backdrop. The input's own delayed autofocus-on-open (below) and its in-place
  // Arrow/Enter suggestion navigation are unrelated concerns and stay exactly as they were.
  const panelRef = useFocusTrap<HTMLDivElement>({ active: isOpen, onEscape: close });

  const trimmedQuery = query.trim();
  const showEmptyState = trimmedQuery.length === 0;
  const isSearching = !showEmptyState && suggestions === null;
  const debouncedQuery = useDebouncedValue(trimmedQuery, 250);

  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSuggestions(null);
    setHighlightedIndex(-1);
    setRecentSearches(getRecentSearches());
    fetchPopularSearches()
      .then((data) => setPopularSearches(data.queries))
      .catch(() => setPopularSearches([]));
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !debouncedQuery) {
      setSuggestions(null);
      return;
    }
    let cancelled = false;
    setSuggestions(null);
    fetchSearchSuggestions(debouncedQuery)
      .then((data) => {
        if (!cancelled) setSuggestions(data);
      })
      .catch(() => {
        if (!cancelled) setSuggestions({ products: [], predictions: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, isOpen]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [query, suggestions, recentSearches, popularSearches]);

  const flatItems: FlatItem[] = useMemo(() => {
    if (showEmptyState) {
      return [
        ...recentSearches.map((text): FlatItem => ({ type: "recent", text })),
        ...popularSearches.map((text): FlatItem => ({ type: "popular", text })),
      ];
    }
    if (!suggestions) return [];
    return [
      ...suggestions.predictions.map((text): FlatItem => ({ type: "prediction", text })),
      ...suggestions.products.map((product): FlatItem => ({ type: "product", product })),
      { type: "see-all", text: trimmedQuery },
    ];
  }, [showEmptyState, recentSearches, popularSearches, suggestions, trimmedQuery]);

  function close() {
    recognitionRef.current?.stop();
    setListening(false);
    closeStore();
  }

  function clearQuery() {
    setQuery("");
    inputRef.current?.focus();
  }

  function submitSearch(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    addRecentSearch(trimmed);
    closeStore();
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  function goToProduct(product: SearchSuggestionProduct) {
    if (trimmedQuery) addRecentSearch(trimmedQuery);
    closeStore();
    router.push(`/product/${product.slug}`);
  }

  function selectItem(item: FlatItem) {
    if (item.type === "product") {
      goToProduct(item.product);
    } else {
      submitSearch(item.text);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = highlightedIndex >= 0 ? flatItems[highlightedIndex] : undefined;
      if (item) selectItem(item);
      else if (trimmedQuery) submitSearch(trimmedQuery);
    } else if (e.key === "Escape") {
      close();
    }
  }

  function handleClearRecent() {
    clearRecentSearches();
    setRecentSearches([]);
  }

  function handleRemoveRecent(text: string) {
    removeRecentSearch(text);
    setRecentSearches((prev) => prev.filter((t) => t !== text));
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-ink-950/40 p-4 pt-16 backdrop-blur-sm animate-fade-in"
      onClick={close}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex w-full max-w-2xl animate-modal-in flex-col overflow-hidden rounded-2xl bg-cream-50 shadow-floatLg"
      >
        <div className="flex items-center gap-3 px-4 py-3.5">
          {isSearching ? (
            <Loader2 size={19} className="shrink-0 animate-spin text-ink-300" />
          ) : (
            <Search size={19} className="shrink-0 text-ink-400" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search products…"
            className="min-w-0 flex-1 border-none bg-transparent text-base text-ink-900 outline-none placeholder:text-ink-400"
          />
          {query && (
            <button
              type="button"
              onClick={clearQuery}
              aria-label="Clear search"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-300 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-700"
            >
              <X size={15} />
            </button>
          )}
          {speechSupported && (
            <>
              <span className="h-5 w-px shrink-0 bg-ink-200" aria-hidden />
              <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-ink-50 p-1">
                <button
                  type="button"
                  onClick={() => setLangBn((v) => !v)}
                  aria-label="Toggle voice search language"
                  className="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-500 transition-colors duration-150 ease-smooth hover:bg-white hover:text-ink-900"
                >
                  {langBn ? "বাংলা" : "EN"}
                </button>
                <button
                  type="button"
                  onClick={listening ? stopVoiceSearch : startVoiceSearch}
                  aria-label={listening ? "Stop voice search" : "Search by voice"}
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ease-smooth",
                    listening
                      ? "bg-danger-500 text-white animate-pulse"
                      : "text-ink-400 hover:bg-white hover:text-ink-900",
                  )}
                >
                  <Mic size={15} />
                </button>
              </div>
            </>
          )}
          <span className="h-5 w-px shrink-0 bg-ink-200" aria-hidden />
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-900"
          >
            <X size={19} />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto border-t border-ink-100">
          {showEmptyState ? (
            <>
              {recentSearches.length > 0 && (
                <div className="border-b border-ink-100 px-4 py-4 last:border-b-0">
                  <div className="flex items-center justify-between">
                    <SectionHeading icon={Clock}>Recent</SectionHeading>
                    <button
                      type="button"
                      onClick={handleClearRecent}
                      className="text-xs text-ink-400 transition-colors duration-150 ease-smooth hover:text-ink-700"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {recentSearches.map((text, i) => (
                      <SuggestionChip
                        key={`recent-${text}`}
                        text={text}
                        icon={Clock}
                        highlighted={highlightedIndex === i}
                        onClick={() => submitSearch(text)}
                        onRemove={() => handleRemoveRecent(text)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {popularSearches.length > 0 && (
                <div className="px-4 py-4">
                  <SectionHeading icon={TrendingUp}>Trending</SectionHeading>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {popularSearches.map((text, i) => (
                      <SuggestionChip
                        key={`popular-${text}`}
                        text={text}
                        icon={TrendingUp}
                        highlighted={highlightedIndex === recentSearches.length + i}
                        onClick={() => submitSearch(text)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {recentSearches.length === 0 && popularSearches.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
                  <Search size={26} className="text-ink-200" />
                  <p className="text-sm text-ink-400">Search for products, brands and more</p>
                </div>
              )}
            </>
          ) : isSearching ? (
            <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-ink-400">
              <Loader2 size={15} className="animate-spin" />
              Searching…
            </div>
          ) : (
            <>
              {suggestions!.predictions.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 pt-4">
                  {suggestions!.predictions.map((text, i) => (
                    <SuggestionChip
                      key={`prediction-${text}`}
                      text={text}
                      icon={Search}
                      highlighted={highlightedIndex === i}
                      onClick={() => submitSearch(text)}
                    />
                  ))}
                </div>
              )}
              {suggestions!.products.length > 0 && (
                <ul className="mt-2 px-2 pb-2">
                  {suggestions!.products.map((product, i) => {
                    const idx = suggestions!.predictions.length + i;
                    const isHighlighted = highlightedIndex === idx;
                    return (
                      <li key={product.id}>
                        <Link
                          href={`/product/${product.slug}`}
                          onClick={(e) => {
                            // Navigate imperatively rather than relying on the anchor's default
                            // navigation — closing the overlay unmounts this link in the same
                            // tick, which cancels the browser's default click-to-navigate.
                            e.preventDefault();
                            goToProduct(product);
                          }}
                          className={cn(
                            "flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors duration-150 ease-smooth hover:bg-ink-50",
                            isHighlighted && "bg-ink-50",
                          )}
                        >
                          {product.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- small suggestion thumbnail, not worth next/image here
                            <img src={product.imageUrl} alt={product.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                          ) : (
                            <div className="h-12 w-12 shrink-0 rounded-lg bg-ink-100" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-ink-900">{product.name}</p>
                            <p className="text-xs text-ink-400">{formatPrice(product.price)}</p>
                          </div>
                          <ArrowUpRight
                            size={15}
                            className={cn("shrink-0 text-ink-300 transition-opacity duration-150 ease-smooth", isHighlighted ? "opacity-100" : "opacity-0")}
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {suggestions!.products.length === 0 && suggestions!.predictions.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-ink-400">
                  {suggestions!.didYouMean ? (
                    <p>
                      No matches — did you mean{" "}
                      <button
                        type="button"
                        onClick={() => submitSearch(suggestions!.didYouMean!)}
                        className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900"
                      >
                        &ldquo;{suggestions!.didYouMean}&rdquo;
                      </button>
                      ?
                    </p>
                  ) : (
                    <p>No matches yet — try &ldquo;see all results&rdquo; below.</p>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => submitSearch(trimmedQuery)}
                className={cn(
                  "flex w-full items-center justify-between border-t border-ink-100 px-4 py-3.5 text-left text-sm font-medium text-ink-900 transition-colors duration-150 ease-smooth hover:bg-ink-50",
                  highlightedIndex === suggestions!.predictions.length + suggestions!.products.length && "bg-ink-50",
                )}
              >
                See all results for &ldquo;{trimmedQuery}&rdquo;
                <ArrowUpRight size={15} />
              </button>
            </>
          )}
        </div>

        <div className="hidden items-center gap-4 border-t border-ink-100 bg-ink-50/60 px-4 py-2 text-[11px] text-ink-400 sm:flex">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-ink-200 bg-white px-1.5 py-0.5 font-sans">↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-ink-200 bg-white px-1.5 py-0.5 font-sans">↵</kbd> select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-ink-200 bg-white px-1.5 py-0.5 font-sans">esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
