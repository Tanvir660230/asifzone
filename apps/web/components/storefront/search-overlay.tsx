"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mic, Search, X } from "lucide-react";
import type { SearchSuggestionProduct, SearchSuggestions } from "@clothing-brand/shared";
import { fetchPopularSearches, fetchSearchSuggestions } from "@/lib/api/storefront";
import { addRecentSearch, clearRecentSearches, getRecentSearches } from "@/lib/recent-searches";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
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

function SuggestionChip({ text, highlighted, onClick }: { text: string; highlighted: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border border-ink-200 px-3 py-1.5 text-sm text-ink-700 transition-colors duration-150 ease-smooth hover:border-brass-400 hover:text-brass-600",
        highlighted && "border-brass-400 text-brass-600",
      )}
    >
      {text}
    </button>
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

  const trimmedQuery = query.trim();
  const showEmptyState = trimmedQuery.length === 0;
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
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto w-full max-w-2xl animate-modal-in overflow-hidden rounded-2xl bg-cream-50 shadow-floatLg"
      >
        <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-4">
          <Search size={20} className="shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search products…"
            className="min-w-0 flex-1 border-none bg-transparent text-base text-ink-900 outline-none placeholder:text-ink-400"
          />
          {speechSupported && (
            <>
              <button
                type="button"
                onClick={() => setLangBn((v) => !v)}
                aria-label="Toggle voice search language"
                className="shrink-0 rounded-full border border-ink-200 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-500 transition-colors duration-150 ease-smooth hover:border-ink-400"
              >
                {langBn ? "বাংলা" : "EN"}
              </button>
              <button
                type="button"
                onClick={listening ? stopVoiceSearch : startVoiceSearch}
                aria-label={listening ? "Stop voice search" : "Search by voice"}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ease-smooth",
                  listening ? "bg-danger-100 text-danger-600" : "text-ink-400 hover:bg-ink-100 hover:text-ink-900",
                )}
              >
                <Mic size={18} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors duration-150 ease-smooth hover:bg-ink-100 hover:text-ink-900"
          >
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto pb-4">
          {showEmptyState ? (
            <>
              {recentSearches.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-4 pt-4">
                    <h3 className="text-xs uppercase tracking-wide text-ink-400">Recent Searches</h3>
                    <button
                      type="button"
                      onClick={handleClearRecent}
                      className="text-xs text-ink-400 transition-colors duration-150 ease-smooth hover:text-ink-700"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 px-4 py-3">
                    {recentSearches.map((text, i) => (
                      <SuggestionChip
                        key={`recent-${text}`}
                        text={text}
                        highlighted={highlightedIndex === i}
                        onClick={() => submitSearch(text)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {popularSearches.length > 0 && (
                <div>
                  <h3 className="px-4 pt-4 text-xs uppercase tracking-wide text-ink-400">Popular Searches</h3>
                  <div className="flex flex-wrap gap-2 px-4 py-3">
                    {popularSearches.map((text, i) => (
                      <SuggestionChip
                        key={`popular-${text}`}
                        text={text}
                        highlighted={highlightedIndex === recentSearches.length + i}
                        onClick={() => submitSearch(text)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {recentSearches.length === 0 && popularSearches.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-ink-400">Start typing to search…</p>
              )}
            </>
          ) : suggestions === null ? (
            <p className="px-4 py-8 text-center text-sm text-ink-400">Searching…</p>
          ) : (
            <>
              {suggestions.predictions.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 pt-4">
                  {suggestions.predictions.map((text, i) => (
                    <SuggestionChip
                      key={`prediction-${text}`}
                      text={text}
                      highlighted={highlightedIndex === i}
                      onClick={() => submitSearch(text)}
                    />
                  ))}
                </div>
              )}
              {suggestions.products.length > 0 && (
                <ul className="mt-2">
                  {suggestions.products.map((product, i) => {
                    const idx = suggestions.predictions.length + i;
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
                            "flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 ease-smooth hover:bg-ink-50",
                            highlightedIndex === idx && "bg-ink-50",
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
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {suggestions.products.length === 0 && suggestions.predictions.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-ink-400">No matches yet — try “see all results” below.</p>
              )}
              <button
                type="button"
                onClick={() => submitSearch(trimmedQuery)}
                className={cn(
                  "mt-2 flex w-full items-center justify-between border-t border-ink-100 px-4 py-3 text-left text-sm text-brass-600 transition-colors duration-150 ease-smooth hover:bg-ink-50",
                  highlightedIndex === suggestions.predictions.length + suggestions.products.length && "bg-ink-50",
                )}
              >
                See all results for &ldquo;{trimmedQuery}&rdquo;
                <Search size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
