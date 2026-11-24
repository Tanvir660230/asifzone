import { z } from "zod";

/*
 * "Find my size": a size from height and weight (plus, optionally, chest, the size worn elsewhere and whether it is worn
 * over a thick layer). The rules are data — a fit profile saved on a size guide preset — so each brand and garment
 * keeps its own table and the storefront never hard-codes one brand's sizing.
 *
 * A profile is a height × weight table: for each height band, the heaviest weight each size fits. The table already
 * carries the brand's own fit (a jacket that runs small simply has lower limits). The suggestion is the largest of the
 * table, the body chest (when given) and the usual size (+1 when the garment runs small). Hint zones mark weights near a
 * limit, where the next size is worth naming (looser fit, over a panjabi) or the smaller one still fits (snug).
 */

export const fitBandSchema = z.object({
  /** Inclusive upper height of this band in inches; null = this height and taller (the last band). */
  maxHeightIn: z.number().int().min(48).max(96).nullable(),
  /** Per size (same order as `sizes`): the heaviest weight in kg it fits in this band; null = not for this band. */
  maxKg: z.array(z.number().min(20).max(250).nullable()),
});
export type FitBand = z.infer<typeof fitBandSchema>;

export const fitHintSchema = z.object({
  /** The band this zone belongs to, by its `maxHeightIn`. */
  maxHeightIn: z.number().int().min(48).max(96).nullable(),
  fromKg: z.number().min(20).max(250),
  toKg: z.number().min(20).max(250),
  /** looser: the next size up suits a loose fit or a thick layer underneath. snug: the next size down also fits, tightly. */
  kind: z.enum(["looser", "snug"]),
});
export type FitHint = z.infer<typeof fitHintSchema>;

export const fitProfileSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Smallest to largest, matching the product's size labels. */
    sizes: z.array(z.string().trim().min(1).max(12)).min(1).max(12),
    bands: z.array(fitBandSchema).min(1).max(12),
    /** Per size: the largest body chest (inches) it fits; null = no limit for that size. */
    chestMaxIn: z.array(z.number().min(20).max(70).nullable()).optional(),
    /** The garment runs a size small: the size worn elsewhere counts one up. */
    runsSmall: z.boolean().default(false),
    hints: z.array(fitHintSchema).max(40).default([]),
    /** One line under the result ("Our jackets run one size small — already counted."). */
    note: z.string().trim().max(160).optional(),
  })
  .superRefine((p, ctx) => {
    p.bands.forEach((b, i) => {
      if (b.maxKg.length !== p.sizes.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bands", i, "maxKg"], message: `Band ${i + 1} needs a weight for each of the ${p.sizes.length} sizes` });
      if (i < p.bands.length - 1 && b.maxHeightIn === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bands", i, "maxHeightIn"], message: "Only the last band can be open-ended" });
      const prev = p.bands[i - 1]?.maxHeightIn;
      if (i > 0 && prev != null && b.maxHeightIn !== null && b.maxHeightIn <= prev) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bands", i, "maxHeightIn"], message: "Bands must go from short to tall" });
      const limits = b.maxKg.filter((x): x is number => x !== null);
      if (limits.some((x, j) => j > 0 && x <= limits[j - 1]!)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bands", i, "maxKg"], message: `Band ${i + 1}: each size must fit a heavier weight than the one before` });
    });
    if (p.chestMaxIn && p.chestMaxIn.length !== p.sizes.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chestMaxIn"], message: "Give a chest limit for each size (or leave it empty)" });
  });
export type FitProfile = z.infer<typeof fitProfileSchema>;

export interface FitInput {
  heightIn: number;
  weightKg: number;
  chestIn?: number | null;
  /** The size worn in other brands. */
  usualSize?: string | null;
  /** Worn over a thick layer (a panjabi, a sweater): near a limit, take the next size. */
  overLayer?: boolean;
}

export type FitResult =
  | {
      status: "ok";
      size: string;
      /** What decided it: the height/weight table, the body chest or the usual size. */
      source: "table" | "chest" | "usual";
      /** A second size worth naming, or null. */
      alternative: { size: string; kind: "looser" | "snug" } | null;
      /** True when "over a thick layer" moved the suggestion one size up. */
      upForLayer: boolean;
    }
  | { status: "too-large" }
  | { status: "invalid"; field: "height" | "weight" | "chest" };

export const FIT_LIMITS = { heightIn: [54, 84], weightKg: [30, 200], chestIn: [26, 60] } as const;

const LADDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL"];
const ALIASES: Record<string, string> = { "2XL": "XXL", "3XL": "XXXL", XXXXL: "4XL" };
const norm = (s: string) => {
  const u = s.trim().toUpperCase().replace(/\s+/g, "");
  return ALIASES[u] ?? u;
};

/** Position of a size worn elsewhere on this profile's scale (may be below 0 or past the end). */
function usualIndex(profile: FitProfile, usual: string): number | null {
  const own = profile.sizes.findIndex((s) => norm(s) === norm(usual));
  if (own !== -1) return own;
  const at = LADDER.indexOf(norm(usual));
  const base = LADDER.indexOf(norm(profile.sizes[0]!));
  return at === -1 || base === -1 ? null : at - base;
}

export function bandFor(profile: FitProfile, heightIn: number): FitBand {
  return profile.bands.find((b) => b.maxHeightIn === null || heightIn <= b.maxHeightIn) ?? profile.bands[profile.bands.length - 1]!;
}

const inRange = (n: number, [lo, hi]: readonly [number, number]) => Number.isFinite(n) && n >= lo && n <= hi;

export function recommendSize(profile: FitProfile, input: FitInput): FitResult {
  if (!inRange(input.heightIn, FIT_LIMITS.heightIn)) return { status: "invalid", field: "height" };
  if (!inRange(input.weightKg, FIT_LIMITS.weightKg)) return { status: "invalid", field: "weight" };
  const chest = input.chestIn ?? null;
  if (chest !== null && !inRange(chest, FIT_LIMITS.chestIn)) return { status: "invalid", field: "chest" };

  const band = bandFor(profile, input.heightIn);
  const table = band.maxKg.findIndex((max) => max !== null && input.weightKg <= max);
  if (table === -1) return { status: "too-large" };

  let fromChest: number | null = null;
  if (chest !== null && profile.chestMaxIn?.length) {
    fromChest = profile.chestMaxIn.findIndex((max) => max === null || chest <= max);
    if (fromChest === -1) return { status: "too-large" };
  }

  const worn = input.usualSize ? usualIndex(profile, input.usualSize) : null;
  const fromUsual = worn === null ? null : worn + (profile.runsSmall ? 1 : 0);
  if (fromUsual !== null && fromUsual >= profile.sizes.length) return { status: "too-large" };

  let index = table;
  let source: "table" | "chest" | "usual" = "table";
  if (fromChest !== null && fromChest > index) [index, source] = [fromChest, "chest"];
  if (fromUsual !== null && fromUsual > index) [index, source] = [fromUsual, "usual"];

  let alternative: { size: string; kind: "looser" | "snug" } | null = null;
  let upForLayer = false;
  if (source === "table") {
    const zone = profile.hints.find((h) => h.maxHeightIn === band.maxHeightIn && input.weightKg >= h.fromKg && input.weightKg <= h.toKg);
    if (zone?.kind === "looser" && index + 1 < profile.sizes.length && band.maxKg[index + 1] != null) {
      if (input.overLayer) {
        index += 1;
        upForLayer = true;
      } else {
        alternative = { size: profile.sizes[index + 1]!, kind: "looser" };
      }
    } else if (zone?.kind === "snug" && index > 0 && !input.overLayer) {
      const chestLimit = profile.chestMaxIn?.[index - 1];
      if (chest === null || chestLimit == null || chest <= chestLimit + 2) alternative = { size: profile.sizes[index - 1]!, kind: "snug" };
    }
  }
  return { status: "ok", size: profile.sizes[index]!, source, alternative, upForLayer };
}

/** "5'8"" from inches. */
export const formatHeight = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;

/**
 * A ready-made starting point for a jacket that runs one size small (Sherpa-lined, regular fit), from a shop's real
 * fittings. Offered in the admin as "Start from an example"; every number stays editable.
 */
export const EXAMPLE_FIT_PROFILE: FitProfile = {
  enabled: true,
  sizes: ["M", "L", "XL", "XXL", "XXXL"],
  bands: [
    { maxHeightIn: 63, maxKg: [55, 74, 84, 95, 105] },
    { maxHeightIn: 67, maxKg: [null, 80, 84, 95, 105] },
    { maxHeightIn: 70, maxKg: [null, 50, 84, 95, 105] },
    { maxHeightIn: 73, maxKg: [null, null, 75, 95, 105] },
    { maxHeightIn: null, maxKg: [null, null, null, 95, 105] },
  ],
  chestMaxIn: [35, 37, 39, 41, 43],
  runsSmall: true,
  hints: [
    { maxHeightIn: 63, fromKg: 53, toKg: 55, kind: "looser" },
    { maxHeightIn: 63, fromKg: 72, toKg: 74, kind: "looser" },
    { maxHeightIn: 67, fromKg: 76, toKg: 80, kind: "looser" },
    { maxHeightIn: 70, fromKg: 81, toKg: 84, kind: "looser" },
    { maxHeightIn: 73, fromKg: 72, toKg: 75, kind: "looser" },
    { maxHeightIn: 63, fromKg: 85, toKg: 91, kind: "snug" },
    { maxHeightIn: 67, fromKg: 85, toKg: 91, kind: "snug" },
    { maxHeightIn: 70, fromKg: 85, toKg: 91, kind: "snug" },
    { maxHeightIn: 63, fromKg: 96, toKg: 100, kind: "snug" },
    { maxHeightIn: 67, fromKg: 96, toKg: 100, kind: "snug" },
    { maxHeightIn: 70, fromKg: 96, toKg: 100, kind: "snug" },
    { maxHeightIn: 73, fromKg: 96, toKg: 100, kind: "snug" },
    { maxHeightIn: null, fromKg: 96, toKg: 100, kind: "snug" },
  ],
  note: "Our jackets run one size small — that's already counted here.",
};
