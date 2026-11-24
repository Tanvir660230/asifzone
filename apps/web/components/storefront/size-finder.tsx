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

/* The website speaks English (lib/buy-copy.ts); the finder's words live here, next to the only place that uses them. */
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
  garment: (chest?: string, length?: string) => [chest && `Chest ${chest}″`, length && `Length ${length}″`].filter(Boolean).join(" · "),
} as const;

const FEET = [4, 5, 6, 7];
const INCHES = Array.from({ length: 12 }, (_, i) => i);
const USUAL_SIZES = ["S", "M", "L", "XL", "XXL", "XXXL"];

/** The garment's own chest and length for a size, read from the chart's columns. */
function garmentLine(chart: SizeGuideData | undefined, size: string): string {
  if (!chart) return "";
  const col = (re: RegExp) => chart.columns.findIndex((c) => re.test(c));
  const row = chart.rows.find((r) => r[0]?.trim().toUpperCase() === size.toUpperCase());
  if (!row) return "";
  const chest = col(/chest|বুক/i);
  const length = col(/length|লম্বা/i);
  return FIT.garment(chest > 0 ? row[chest] : undefined, length > 0 ? row[length] : undefined);
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
}

export function SizeFinder({ fit, chart, offered, sellable, onSelect, openRequest }: SizeFinderProps) {
  const [open, setOpen] = useState(false);
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
    onSelect(size);
    setOpen(false);
  }

  const stepWeight = (d: number) => setWeight(String(Math.min(200, Math.max(30, (Number.isFinite(weightKg) && weight ? weightKg : 65) + d))));
  const field = "h-12 w-full rounded-[var(--control-radius)] border border-ink-200 bg-surface px-3 text-base text-ink-900 shadow-sm outline-none transition-colors focus-visible:border-ink-900 focus-visible:ring-2 focus-visible:ring-accent/30";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-900 underline underline-offset-2 hover:text-accent"
        data-testid="size-finder-open"
      >
        <PersonStanding size={13} aria-hidden="true" /> {FIT.open}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={FIT.title}
        description={FIT.intro}
        widthClassName="max-w-md"
        footer={
          <Button type="button" variant="primary" size="lg" className="w-full" disabled={!canSelect} onClick={choose} data-testid="size-finder-select">
            {size && canSelect ? FIT.select(size) : FIT.select("size")}
          </Button>
        }
      >
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-xs ui-caps text-ink-500">{FIT.height}</legend>
            <div className="grid grid-cols-2 gap-2">
              <label htmlFor={ids.feet} className="sr-only">{FIT.feet}</label>
              <select id={ids.feet} className={field} value={feet ?? ""} onChange={(e) => { setFeet(e.target.value === "" ? null : Number(e.target.value)); if (inches === null) setInches(0); }} data-testid="size-finder-feet">
                <option value="">{FIT.feet}</option>
                {FEET.map((f) => <option key={f} value={f}>{f} ft</option>)}
              </select>
              <label htmlFor={ids.inches} className="sr-only">{FIT.inches}</label>
              <select id={ids.inches} className={field} value={inches ?? ""} onChange={(e) => setInches(e.target.value === "" ? null : Number(e.target.value))} data-testid="size-finder-inches">
                <option value="">{FIT.inches}</option>
                {INCHES.map((i) => <option key={i} value={i}>{i} in</option>)}
              </select>
            </div>
          </fieldset>

          <div>
            <label htmlFor={ids.weight} className="mb-2 block text-xs ui-caps text-ink-500">{FIT.weight}</label>
            <div className="flex items-stretch gap-2">
              <button type="button" aria-label="Less weight" onClick={() => stepWeight(-1)} className="ui-tap flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--control-radius)] border border-ink-200 text-ink-700 transition active:scale-95">
                <Minus size={16} />
              </button>
              <div className="relative min-w-0 flex-1">
                <input
                  id={ids.weight}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="65"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
                  className={cn(field, "pr-12 text-center tabular-nums")}
                  data-testid="size-finder-weight"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-500">kg</span>
              </div>
              <button type="button" aria-label="More weight" onClick={() => stepWeight(1)} className="ui-tap flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--control-radius)] border border-ink-200 text-ink-700 transition active:scale-95">
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-ink-100">
            <button type="button" aria-expanded={moreOpen} aria-controls={ids.more} onClick={() => setMoreOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-ink-800">
              {FIT.more}
              <ChevronDown size={16} className={cn("transition-transform duration-200", moreOpen && "rotate-180")} aria-hidden="true" />
            </button>
            <AnimatePresence initial={false}>
              {moreOpen && (
                <motion.div id={ids.more} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="overflow-hidden">
                  <div className="space-y-4 border-t border-ink-100 px-4 pb-4 pt-3">
                    <div>
                      <label htmlFor={ids.chest} className="block text-sm text-ink-800">{FIT.chest}</label>
                      <p className="mb-2 text-xs text-ink-500">{FIT.chestHint}</p>
                      <div className="relative">
                        <input id={ids.chest} inputMode="decimal" placeholder="38" value={chest} onChange={(e) => setChest(e.target.value.replace(/[^\d.]/g, "").slice(0, 4))} className={cn(field, "pr-16 tabular-nums")} data-testid="size-finder-chest" />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-500">inches</span>
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-sm text-ink-800">{FIT.usual}</p>
                      <div className="flex flex-wrap gap-2" role="group" aria-label={FIT.usual}>
                        {USUAL_SIZES.map((s) => (
                          <button key={s} type="button" aria-pressed={usual === s} onClick={() => setUsual(usual === s ? null : s)} className={cn("ui-tap-sm min-w-11 rounded-full border px-3 py-1.5 text-sm transition", usual === s ? "border-ink-900 bg-ink-900 text-cream-50" : "border-ink-200 text-ink-700 hover:border-ink-400")}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="flex items-center justify-between gap-3 text-sm text-ink-800">
                      <span>{FIT.layer}</span>
                      <Switch checked={overLayer} onChange={setOverLayer} aria-label={FIT.layer} />
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div aria-live="polite" className="min-h-[7.5rem] rounded-2xl bg-ink-900/[0.04] p-4" data-testid="size-finder-result">
            <ResultView result={result} answers={answers} fit={fit} chart={chart} made={made} sellable={sellable} />
          </div>
        </div>
      </Modal>
    </>
  );
}

function ResultView({ result, answers, fit, chart, made, sellable }: { result: FitResult | null; answers: FitAnswers | null; fit: FitProfile; chart?: SizeGuideData; made: boolean; sellable: (size: string) => boolean }) {
  if (!result || !answers) return <p className="text-sm text-ink-500">{FIT.waiting}</p>;
  if (result.status === "invalid") return <p className="text-sm text-ink-700">{FIT.invalid[result.field]}</p>;
  if (result.status === "too-large") return <p className="text-sm text-ink-700">{FIT.tooLarge}</p>;
  const { size } = result;
  const garment = garmentLine(chart, size);
  const why =
    result.source === "chest" ? FIT.byChest : result.source === "usual" && answers.usualSize ? FIT.byUsual(answers.usualSize, size) : result.upForLayer ? FIT.upForLayer : null;
  const extra = result.alternative ? (result.alternative.kind === "looser" ? FIT.looser(result.alternative.size) : FIT.snug(result.alternative.size)) : null;
  return (
    <motion.div key={size} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }} className="flex gap-4">
      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-ink-900 text-cream-50">
        <span className="text-[0.625rem] uppercase tracking-wider opacity-70">{FIT.yourSize}</span>
        <span className="font-display text-2xl leading-none" data-testid="size-finder-size">{size}</span>
      </div>
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-medium text-ink-900">{FIT.basis(answers)}</p>
        {garment && <p className="text-ink-600">{garment}</p>}
        {why && <p className="text-ink-600">{why}</p>}
        {extra && <p className="text-ink-600">{extra}</p>}
        {!made && <p className="font-medium text-ink-900">{FIT.notMade(size)}</p>}
        {made && !sellable(size) && <p className="font-medium text-ink-900">{FIT.soldOut(size)}</p>}
        {fit.note && <p className="text-xs text-ink-500">{fit.note}</p>}
      </div>
    </motion.div>
  );
}
