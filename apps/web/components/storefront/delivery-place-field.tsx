"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, MapPin, Search, X } from "lucide-react";
import {
  BD_ALL_DISTRICTS,
  BD_AREAS_BY_DISTRICT,
  bdAreaNameBn,
  bdDistrictNameBn,
  readBdAddress,
  searchBdAreas,
  type AddressReading,
  type BdPlace,
} from "@clothing-brand/shared";
import { cn } from "@/lib/utils";

/*
 * Thana & district in one box, for how people here actually fill a delivery form: on a phone, address first, in Bangla or
 * English, often knowing the thana but not which district it is in. Nothing here is required — the order goes through
 * without it — but the box reads the thana out of the written address on its own, asks "which Kaliganj?" when a name
 * belongs to several districts instead of guessing, and points out a picked thana the address contradicts. The same
 * reader (readBdAddress) fills an empty thana on the server and flags the order for staff.
 */

type Lang = "en" | "bn";

const COPY = {
  en: {
    label: "Thana & district",
    optional: "Optional",
    help: "Helps the courier reach you a day sooner. Write it in your address and we fill it in.",
    placeholder: "Search thana, e.g. Demra",
    fromAddress: "Taken from your address",
    which: (name: string) => `Which ${name}?`,
    writtenElsewhere: (place: string) => `Your address says ${place}.`,
    use: "Use this",
    short: "Add a road, bazar or a nearby mosque, school or shop so the rider finds the door.",
    districtOnly: "district",
    pickThana: "now pick the thana",
    clear: "Clear",
    none: "No thana by that name. Write it in your address and we will check on the call.",
  },
  bn: {
    label: "থানা ও জেলা",
    optional: "ঐচ্ছিক",
    help: "এটা দিলে কুরিয়ার এক দিন আগে পৌঁছাতে পারে। ঠিকানায় থানা লিখলে আমরা নিজেই বসিয়ে দেবো।",
    placeholder: "থানা খুঁজুন, যেমন ডেমরা",
    fromAddress: "আপনার ঠিকানা থেকে নেওয়া",
    which: (name: string) => `কোন ${name}?`,
    writtenElsewhere: (place: string) => `আপনার ঠিকানায় লেখা ${place}।`,
    use: "এটাই দিন",
    short: "রাইডার যেন বাসা খুঁজে পায়: রোড, বাজার বা কাছের মসজিদ, স্কুল বা দোকানের নাম লিখুন।",
    districtOnly: "জেলা",
    pickThana: "এবার থানা বাছুন",
    clear: "মুছুন",
    none: "এই নামে থানা পাইনি। ঠিকানায় লিখে দিন, কলে আমরা মিলিয়ে নেবো।",
  },
} as const;

interface Option {
  key: string;
  district: string;
  area: string | null;
}

export interface DeliveryPlaceFieldProps {
  id: string;
  lang: Lang;
  /** The written address (debounce it: the reader runs on every change). */
  addressLine: string;
  district: string;
  area: string;
  onChange: (place: { district: string; area: string }) => void;
  className?: string;
}

export function DeliveryPlaceField({ id, lang, addressLine, district, area, onChange, className }: DeliveryPlaceFieldProps) {
  const t = COPY[lang];
  const areaName = (p: BdPlace) => (lang === "bn" ? bdAreaNameBn(p.district, p.area) : p.area);
  const districtName = (d: string) => (lang === "bn" ? bdDistrictNameBn(d) : d);
  const placeName = (p: BdPlace) => `${areaName(p)}, ${districtName(p.district)}`;

  // Whether the current value came from reading the address (it then follows the address) or from the shopper.
  const [auto, setAuto] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // What the address alone says (no picks), and the checks of the picks against it.
  const fromText: AddressReading = useMemo(() => readBdAddress({ addressLine, district: auto ? null : district || null }), [addressLine, auto, district]);
  const checked: AddressReading = useMemo(() => readBdAddress({ addressLine, district: district || null, area: area || null }), [addressLine, district, area]);

  // Fill (or follow) the thana from the address while the shopper hasn't picked one themselves.
  useEffect(() => {
    if (area && !auto) return;
    const next = fromText.area && fromText.district ? { district: fromText.district, area: fromText.area } : null;
    if (next && (next.area !== area || next.district !== district)) {
      setAuto(true);
      onChange(next);
    } else if (!next && auto) {
      setAuto(false);
      onChange({ district: "", area: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromText.area, fromText.district]);

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, []);

  const options: Option[] = useMemo(() => {
    const q = query.trim();
    const narrowed = district && !area ? district : null;
    // A district picked without a thana: its whole thana list until something is typed.
    if (!q) return narrowed ? (BD_AREAS_BY_DISTRICT[narrowed] ?? []).map((a) => ({ key: `${a}|${narrowed}`, district: narrowed, area: a })) : [];
    const areas = searchBdAreas(q, { district: narrowed, limit: 8 });
    const list: Option[] = areas.map((p) => ({ key: `${p.area}|${p.district}`, district: p.district, area: p.area }));
    // Someone who knows only the district can start there.
    if (q && !narrowed) {
      const bnQ = /[ঀ-৿]/.test(q);
      // Districts by the start of their name only — a loose match ("adab" → Chapainawabganj) is noise under a thana list.
      const districts = bnQ ? BD_ALL_DISTRICTS.filter((d) => bdDistrictNameBn(d).startsWith(q)) : BD_ALL_DISTRICTS.filter((d) => d.toLowerCase().startsWith(q.toLowerCase()));
      for (const d of districts.slice(0, 3)) list.push({ key: `|${d}`, district: d, area: null });
    }
    return list;
  }, [query, district, area]);

  useEffect(() => setHighlighted(0), [query, open]);

  function pick(o: Option) {
    setAuto(false);
    onChange({ district: o.district, area: o.area ?? "" });
    setQuery("");
    // A district alone: keep the list open on that district's thanas.
    setOpen(o.area === null);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlighted((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      const o = options[highlighted];
      if (o) pick(o);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  const shown = area && district ? placeName({ area, district }) : district ? `${districtName(district)} — ${t.pickThana}` : "";
  const issue = (code: AddressReading["issues"][number]["code"]) => checked.issues.find((i) => i.code === code);
  const unclear = !area ? fromText.areaChoices : [];
  const mismatch = issue("AREA_MISMATCH");
  const districtMismatch = issue("DISTRICT_MISMATCH");
  const short = addressLine.trim().length >= 4 && issue("ADDRESS_SHORT");
  const hintId = `${id}-hint`;

  return (
    <div className={className}>
      {/* "Optional" sits beside the label, not in it: the field keeps its plain name, and the help line says why it helps. */}
      <div className="mb-1.5 flex items-baseline gap-1.5 text-sm">
        <label htmlFor={id} className="font-medium text-fg">
          {t.label}
        </label>
        <span aria-hidden="true" className="text-fg-muted">
          ({t.optional})
        </span>
      </div>
      <div ref={boxRef} className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          aria-describedby={hintId}
          autoComplete="off"
          enterKeyHint="search"
          className="ui-control pl-9 pr-9"
          placeholder={t.placeholder}
          value={open ? query : shown}
          onFocus={(e) => {
            setOpen(true);
            setQuery("");
            e.target.select();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKey}
        />
        {(area || district) && !open ? (
          <button
            type="button"
            aria-label={t.clear}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-fg-subtle hover:text-fg"
            onClick={() => {
              setAuto(false);
              onChange({ district: "", area: "" });
            }}
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
        )}
        {open && (query.trim() || (district && !area)) && (
          <ul id={`${id}-listbox`} role="listbox" className="ui-floating absolute z-overlay mt-1.5 max-h-64 w-full overflow-auto p-1 animate-pop-in">
            {options.length === 0 && <li className="px-3 py-2 text-sm text-fg-muted">{t.none}</li>}
            {options.map((o, i) => (
              <li
                key={o.key}
                role="option"
                aria-selected={o.area === area && o.district === district}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={cn("flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm", i === highlighted && "bg-surface-muted")}
              >
                {o.area ? (
                  <span className="min-w-0">
                    <span className="font-medium text-fg">{areaName({ area: o.area, district: o.district })}</span>
                    <span className="text-fg-muted"> · {districtName(o.district)}</span>
                  </span>
                ) : (
                  <span className="min-w-0 text-fg">
                    {districtName(o.district)} <span className="text-fg-muted">({t.districtOnly})</span>
                  </span>
                )}
                {o.area === area && o.district === district && <Check className="h-4 w-4 shrink-0 text-fg" aria-hidden="true" />}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div id={hintId} className="mt-1.5 space-y-1.5 text-xs" aria-live="polite">
        {unclear.length > 0 ? (
          <div>
            <p className="font-medium text-fg">{t.which(areaName(unclear[0]!))}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {unclear.map((p) => (
                <button
                  key={`${p.area}|${p.district}`}
                  type="button"
                  className="min-h-9 rounded-full border border-line bg-surface px-3 text-xs font-medium text-fg transition-colors hover:border-line-strong"
                  onClick={() => pick({ key: "", district: p.district, area: p.area })}
                >
                  {unclear.every((c) => c.district === p.district) ? areaName(p) : districtName(p.district)}
                </button>
              ))}
            </div>
          </div>
        ) : mismatch?.code === "AREA_MISMATCH" ? (
          <p className="text-warning-700">
            {t.writtenElsewhere(placeName(mismatch.written))}{" "}
            <button type="button" className="font-semibold underline underline-offset-2" onClick={() => pick({ key: "", ...mismatch.written })}>
              {t.use}
            </button>
          </p>
        ) : districtMismatch?.code === "DISTRICT_MISMATCH" ? (
          <p className="text-warning-700">
            {t.writtenElsewhere(districtName(districtMismatch.written))}{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => {
                setAuto(false);
                onChange({ district: districtMismatch.written, area: "" });
                setOpen(true);
              }}
            >
              {t.use}
            </button>
          </p>
        ) : auto && area ? (
          <p className="flex items-center gap-1 text-success-700">
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> {t.fromAddress}
          </p>
        ) : !area ? (
          <p className="text-fg-muted">{t.help}</p>
        ) : null}
        {short && <p className="text-fg-muted">{t.short}</p>}
      </div>
    </div>
  );
}
