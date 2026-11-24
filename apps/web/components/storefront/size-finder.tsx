"use client";

import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Minus, PersonStanding, Plus } from "lucide-react";
import { formatHeight, recommendSize, type FitProfile, type FitResult, type SizeGuideData } from "@clothing-brand/shared";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { readFitAnswers, saveFitAnswers, type FitAnswers } from "@/lib/fit-memory";
import { cn } from "@/lib/utils";

/* The website speaks English (lib/buy-copy.ts), landing pages Bangla; the finder's words live here, next to the only place
   that uses them. Both tables have the same shape. */
const FIT = {
  open: "Find my size",
  title: "Find your size",
  intro: "Your height and weight are enough. We'll pick the size for you.",
  height: "Height",
  feet: "Feet",
  inches: "Inches",
  weight: "Weight",
  more: "More precise (optional)",
  chest: "Body chest",
  chestHint: "Around the fullest part, under the arms",
  usual: "Size you wear in other brands",
  layer: "I'll wear it over a panjabi or sweater",
  waiting: "Enter your height and weight to see your size.",
  yourSize: "Your size",
  basis: (a: FitAnswers) => `For ${formatHeight(a.heightIn)} and ${a.weightKg} kg`,
  byChest: "Your chest measurement decided this one.",
  byUsual: (usual: string, size: string) => `You wear ${usual} elsewhere — here that's ${size}.`,
  upForLayer: "One size up, for room over a panjabi or sweater.",
  looser: (size: string) => `Like it loose, or wearing a panjabi underneath? ${size} works too.`,
  snug: (size: string) => `${size} also fits, a little snug under the arms.`,
  notMade: (size: string) => `This style isn't made in ${size}.`,
  soldOut: (size: string) => `${size} is sold out right now.`,
  tooLarge: "Your measurements are past our largest size. Message us and we'll help you choose.",
  invalid: { height: "Check your height.", weight: "Check your weight (kg).", chest: "Check your chest (inches)." },
  select: (size: string) => `Select ${size}`,
  selectNone: "Select size",
  retry: "Try again",
  heading: null as string | null,
  ft: (n: number) => `${n} ft`,
  inch: (n: number) => `${n} in`,
  kg: "kg",
  inchesUnit: "inches",
  lessWeight: "Less weight",
  moreWeight: "More weight",
  runsSmall: null as string | null,
  cardTitle: "",
  garment: (chest?: string, length?: string) => [chest && `Chest ${chest}″`, length && `Length ${length}″`].filter(Boolean).join(" · "),
};

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bn = (v: number | string) => String(v).replace(/\d/g, (d) => BN_DIGITS[Number(d)]!);
/** Bangla digits typed on a Bangla keyboard count as numbers. */
const asciiDigits = (v: string) => v.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

/* Landing pages: plain Bangla for shoppers coming from a Facebook ad. */
const FIT_BN: typeof FIT = {
  open: "উচ্চতা ও ওজন দিয়ে সাইজ খুঁজুন",
  title: "আপনার জন্য সঠিক সাইজ খুঁজে নিন",
  intro: "আপনার উচ্চতা ও ওজন দিয়ে সাইজ সাজেস্ট করব।",
  height: "উচ্চতা",
  feet: "ফুট",
  inches: "ইঞ্চি",
  weight: "ওজন",
  more: "আরও নিখুঁত করতে (ঐচ্ছিক)",
  chest: "শরীরের বুকের মাপ",
  chestHint: "বগলের ঠিক নিচে, বুকের সবচেয়ে চওড়া জায়গায় ফিতা ঘুরিয়ে",
  usual: "অন্য ব্র্যান্ডে যে সাইজ পরেন",
  layer: "পাঞ্জাবি বা সোয়েটারের ওপর পরবেন",
  waiting: "উচ্চতা ও ওজন দিলে সাইজ দেখাবে।",
  yourSize: "সাইজ",
  basis: (a: FitAnswers) => `${bn(Math.floor(a.heightIn / 12))} ফুট ${bn(a.heightIn % 12)} ইঞ্চি, ${bn(a.weightKg)} কেজির জন্য`,
  byChest: "আপনার বুকের মাপ দেখে এই সাইজ।",
  byUsual: (usual: string, size: string) => `অন্য ব্র্যান্ডে ${usual} পরলে এখানে ${size}।`,
  upForLayer: "পাঞ্জাবি বা সোয়েটারের ওপর আরামে পরতে এক সাইজ বড়।",
  looser: (size: string) => `ঢিলেঢালা পছন্দ করলে বা নিচে পাঞ্জাবি পরলে ${size}-ও ভালো হবে।`,
  snug: (size: string) => `${size}-ও হবে, তবে বগলের নিচে একটু আঁটসাঁট।`,
  notMade: (size: string) => `এই ডিজাইনে ${size} সাইজ তৈরি হয় না।`,
  soldOut: (size: string) => `${size} এখন স্টকে নেই।`,
  tooLarge: "আপনার মাপ আমাদের সবচেয়ে বড় সাইজের চেয়েও বেশি। মেসেজ দিন, আমরা সাইজ বেছে দিতে সাহায্য করব।",
  invalid: { height: "উচ্চতা ঠিক করে দিন।", weight: "ওজন (কেজি) ঠিক করে দিন।", chest: "বুকের মাপ (ইঞ্চি) ঠিক করে দিন।" },
  select: () => "এই সাইজটি নির্বাচন করুন",
  selectNone: "সাইজ নির্বাচন করুন",
  retry: "আবার চেষ্টা করুন",
  heading: "আপনার জন্য আমাদের সাজেশন",
  ft: (n: number) => `${bn(n)} ফুট`,
  inch: (n: number) => `${bn(n)} ইঞ্চি`,
  kg: "কেজি",
  inchesUnit: "ইঞ্চি",
  lessWeight: "ওজন কমান",
  moreWeight: "ওজন বাড়ান",
  runsSmall: "এই ডিজাইন এক সাইজ ছোট মাপের, সাজেশনে সেটা হিসাব করা আছে।",
  cardTitle: "আপনার সঠিক সাইজ জানেন না?",
  garment: (chest?: string, length?: string) => [chest && `পোশাকের বুক ${bn(chest)}″`, length && `লম্বা ${bn(length)}″`].filter(Boolean).join(" · "),
};

const FEET = [4, 5, 6, 7];
const INCHES = Array.from({ length: 12 }, (_, i) => i);
const USUAL_SIZES = ["S", "M", "L", "XL", "XXL", "XXXL"];

/** The garment's own chest and length for a size, read from the chart's columns. */
function garmentLine(T: typeof FIT, chart: SizeGuideData | undefined, size: string): string {
  if (!chart) return "";
  const col = (re: RegExp) => chart.columns.findIndex((c) => re.test(c));
  const row = chart.rows.find((r) => r[0]?.trim().toUpperCase() === size.toUpperCase());
  if (!row) return "";
  const chest = col(/chest|বুক/i);
  const length = col(/length|লম্বা/i);
  return T.garment(chest > 0 ? row[chest] : undefined, length > 0 ? row[length] : undefined);
}

interface SizeFinderProps {
  fit: FitProfile;
  chart?: SizeGuideData;
  /** Sizes this product is made in. */
  offered: readonly string[];
  /** Whether a size can be bought now. */
  sellable: (size: string) => boolean;
  onSelect: (size: string) => void;
  /** Bumped by the page to reopen the finder ("Change" on the auto-picked line). */
  openRequest?: number;
  /** bn: the landing page's Bangla words. */
  copy?: "en" | "bn";
  /** link: a small text link beside the size chips (product page). card: a short prompt with a button (landing page). */
  trigger?: "link" | "card";
  /** The finder was opened (analytics). */
  onOpen?: () => void;
  /** The answers behind a selected size, so the page can keep them with the order. */
  onAnswers?: (answers: FitAnswers, recommended: string) => void;
}

export function SizeFinder({ fit, chart, offered, sellable, onSelect, openRequest, copy = "en", trigger = "link", onOpen, onAnswers }: SizeFinderProps) {
  const T = copy === "bn" ? FIT_BN : FIT;
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    if (next && !open) onOpen?.();
    setOpenState(next);
  };
  const [feet, setFeet] = useState<number | null>(null);
  const [inches, setInches] = useState<number | null>(null);
  const [weight, setWeight] = useState("");
  const [chest, setChest] = useState("");
  const [usual, setUsual] = useState<string | null>(null);
  const [overLayer, setOverLayer] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const ids = { feet: useId(), inches: useId(), weight: useId(), chest: useId(), more: useId() };

  useEffect(() => {
    if (openRequest) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  // Starts from the answers given on an earlier product.
  useEffect(() => {
    if (!open) return;
    const saved = readFitAnswers();
    if (!saved || feet !== null) return;
    setFeet(Math.floor(saved.heightIn / 12));
    setInches(saved.heightIn % 12);
    setWeight(String(saved.weightKg));
    if (saved.chestIn) setChest(String(saved.chestIn));
    setUsual(saved.usualSize ?? null);
    setOverLayer(Boolean(saved.overLayer));
    if (saved.chestIn || saved.usualSize || saved.overLayer) setMoreOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const weightKg = Number(weight);
  const chestIn = chest.trim() ? Number(chest) : null;
  const answers: FitAnswers | null =
    feet !== null && inches !== null && weight.trim() !== "" && Number.isFinite(weightKg)
      ? { heightIn: feet * 12 + inches, weightKg, chestIn, usualSize: usual, overLayer }
      : null;
  const result: FitResult | null = answers ? recommendSize(fit, answers) : null;
  const size = result?.status === "ok" ? result.size : null;
  const made = size ? offered.includes(size) : false;
  const canSelect = Boolean(size && made && sellable(size));

  function choose() {
    if (!answers || !size || !canSelect) return;
    saveFitAnswers(answers);
    onAnswers?.(answers, size);
    onSelect(size);
    setOpen(false);
  }

  function retry() {
    setFeet(null);
    setInches(null);
    setWeight("");
    setChest("");
    setUsual(null);
    setOverLayer(false);
  }

  const stepWeight = (d: number) => setWeight(String(Math.min(200, Math.max(30, (Number.isFinite(weightKg) && weight ? weightKg : 65) + d))));
  const field = "h-12 w-full rounded-[var(--control-radius)] border border-ink-200 bg-surface px-3 text-base text-ink-900 shadow-sm outline-none transition-colors focus-visible:border-ink-900 focus-visible:ring-2 focus-visible:ring-accent/30";

  return (
    <>
      {trigger === "card" ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-muted p-3" data-testid="size-finder-card">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-fg">
            <PersonStanding size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">{T.cardTitle}</p>
            <button type="button" onClick={() => setOpen(true)} className="min-h-11 text-left text-sm font-semibold text-fg underline underline-offset-4" data-testid="size-finder-open">
              {T.open}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-900 underline underline-offset-2 hover:text-accent"
          data-testid="size-finder-open"
        >
          <PersonStanding size={13} aria-hidden="true" /> {T.open}
        </button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={T.title}
        description={T.intro}
        widthClassName="max-w-md"
        footer={
          <div className="flex w-full flex-col gap-2">
            <Button type="button" variant="primary" size="lg" className="w-full" disabled={!canSelect} onClick={choose} data-testid="size-finder-select">
              {size && canSelect ? T.select(size) : copy === "bn" ? T.selectNone : T.select("size")}
            </Button>
            {copy === "bn" && answers && (
              <Button type="button" variant="ghost" size="lg" className="w-full" onClick={retry} data-testid="size-finder-retry">
                {T.retry}
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-xs ui-caps text-ink-500">{T.height}</legend>
            <div className="grid grid-cols-2 gap-2">
              <label htmlFor={ids.feet} className="sr-only">{T.feet}</label>
              <select id={ids.feet} className={field} value={feet ?? ""} onChange={(e) => { setFeet(e.target.value === "" ? null : Number(e.target.value)); if (inches === null) setInches(0); }} data-testid="size-finder-feet">
                <option value="">{T.feet}</option>
                {FEET.map((f) => <option key={f} value={f}>{T.ft(f)}</option>)}
              </select>
              <label htmlFor={ids.inches} className="sr-only">{T.inches}</label>
              <select id={ids.inches} className={field} value={inches ?? ""} onChange={(e) => setInches(e.target.value === "" ? null : Number(e.target.value))} data-testid="size-finder-inches">
                <option value="">{T.inches}</option>
                {INCHES.map((i) => <option key={i} value={i}>{T.inch(i)}</option>)}
              </select>
            </div>
          </fieldset>

          <div>
            <label htmlFor={ids.weight} className="mb-2 block text-xs ui-caps text-ink-500">{T.weight}</label>
            <div className="flex items-stretch gap-2">
              <button type="button" aria-label={T.lessWeight} onClick={() => stepWeight(-1)} className="ui-tap flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--control-radius)] border border-ink-200 text-ink-700 transition active:scale-95">
                <Minus size={16} />
              </button>
              <div className="relative min-w-0 flex-1">
                <input
                  id={ids.weight}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="65"
                  value={weight}
                  onChange={(e) => setWeight(asciiDigits(e.target.value).replace(/[^\d.]/g, "").slice(0, 5))}
                  className={cn(field, "pr-12 text-center tabular-nums")}
                  data-testid="size-finder-weight"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-500">{T.kg}</span>
              </div>
              <button type="button" aria-label={T.moreWeight} onClick={() => stepWeight(1)} className="ui-tap flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--control-radius)] border border-ink-200 text-ink-700 transition active:scale-95">
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-ink-100">
            <button type="button" aria-expanded={moreOpen} aria-controls={ids.more} onClick={() => setMoreOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink-800">
              {T.more}
              <ChevronDown size={16} className={cn("transition-transform duration-200", moreOpen && "rotate-180")} aria-hidden="true" />
            </button>
            <AnimatePresence initial={false}>
              {moreOpen && (
                <motion.div id={ids.more} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="overflow-hidden">
                  <div className="space-y-4 border-t border-ink-100 px-4 pb-4 pt-3">
                    <div>
                      <label htmlFor={ids.chest} className="block text-sm text-ink-800">{T.chest}</label>
                      <p className="mb-2 text-xs text-ink-500">{T.chestHint}</p>
                      <div className="relative">
                        <input id={ids.chest} inputMode="decimal" placeholder="38" value={chest} onChange={(e) => setChest(asciiDigits(e.target.value).replace(/[^\d.]/g, "").slice(0, 4))} className={cn(field, "pr-16 tabular-nums")} data-testid="size-finder-chest" />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-500">{T.inchesUnit}</span>
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-sm text-ink-800">{T.usual}</p>
                      <div className="flex flex-wrap gap-2" role="group" aria-label={T.usual}>
                        {USUAL_SIZES.map((s) => (
                          <button key={s} type="button" aria-pressed={usual === s} onClick={() => setUsual(usual === s ? null : s)} className={cn("ui-tap-sm min-w-11 rounded-full border px-3 py-1.5 text-sm transition", usual === s ? "border-ink-900 bg-ink-900 text-cream-50" : "border-ink-200 text-ink-700 hover:border-ink-400")}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="flex items-center justify-between gap-3 text-sm text-ink-800">
                      <span>{T.layer}</span>
                      <Switch checked={overLayer} onChange={setOverLayer} aria-label={T.layer} />
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div aria-live="polite" className="min-h-[7.5rem] rounded-2xl bg-ink-900/[0.04] p-4" data-testid="size-finder-result">
            <ResultView T={T} result={result} answers={answers} fit={fit} chart={chart} made={made} sellable={sellable} />
          </div>
        </div>
      </Modal>
    </>
  );
}

function ResultView({ T, result, answers, fit, chart, made, sellable }: { T: typeof FIT; result: FitResult | null; answers: FitAnswers | null; fit: FitProfile; chart?: SizeGuideData; made: boolean; sellable: (size: string) => boolean }) {
  if (!result || !answers) return <p className="text-sm text-ink-500">{T.waiting}</p>;
  if (result.status === "invalid") return <p className="text-sm text-ink-700">{T.invalid[result.field]}</p>;
  if (result.status === "too-large") return <p className="text-sm text-ink-700">{T.tooLarge}</p>;
  const { size } = result;
  const garment = garmentLine(T, chart, size);
  const why =
    result.source === "chest" ? T.byChest : result.source === "usual" && answers.usualSize ? T.byUsual(answers.usualSize, size) : result.upForLayer ? T.upForLayer : null;
  const extra = result.alternative ? (result.alternative.kind === "looser" ? T.looser(result.alternative.size) : T.snug(result.alternative.size)) : null;
  return (
    <>
    {T.heading && <p className="mb-3 text-xs font-semibold text-ink-500">{T.heading}</p>}
    <motion.div key={size} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }} className="flex gap-4">
      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-ink-900 text-cream-50">
        <span className="text-[0.625rem] uppercase tracking-wider opacity-70">{T.yourSize}</span>
        <span className="font-display text-2xl leading-none" data-testid="size-finder-size">{size}</span>
      </div>
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-medium text-ink-900">{T.basis(answers)}</p>
        {garment && <p className="text-ink-600">{garment}</p>}
        {why && <p className="text-ink-600">{why}</p>}
        {extra && <p className="text-ink-600">{extra}</p>}
        {!made && <p className="font-medium text-ink-900">{T.notMade(size)}</p>}
        {made && !sellable(size) && <p className="font-medium text-ink-900">{T.soldOut(size)}</p>}
        {/* The profile's note is written in the website's English; the Bangla page says the same thing in Bangla. */}
        {T.runsSmall ? fit.runsSmall && <p className="text-xs text-ink-500">{T.runsSmall}</p> : fit.note && <p className="text-xs text-ink-500">{fit.note}</p>}
      </div>
    </motion.div>
    </>
  );
}
