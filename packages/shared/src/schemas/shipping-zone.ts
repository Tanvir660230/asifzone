import { z } from "zod";
import { BD_ALL_DISTRICTS, BD_DIVISIONS } from "../country/bd";

/** lowercase → official spelling, so "sylhet" is stored as "Sylhet". */
const canonical = (list: readonly string[]) => new Map(list.map((v) => [v.toLowerCase(), v]));
const DISTRICTS = canonical(BD_ALL_DISTRICTS);
const DIVISIONS = canonical(BD_DIVISIONS);

/** One rule a zone matches an address by. District and division names must be real ones — a typo would never match. */
export const shippingZoneMatchSchema = z
  .object({ field: z.enum(["DISTRICT", "DIVISION", "POSTCODE"]), value: z.string().trim().min(1).max(60) })
  .superRefine((m, ctx) => {
    if (m.field === "DISTRICT" && !DISTRICTS.has(m.value.toLowerCase())) ctx.addIssue({ code: "custom", path: ["value"], message: `"${m.value}" isn't a district` });
    if (m.field === "DIVISION" && !DIVISIONS.has(m.value.toLowerCase())) ctx.addIssue({ code: "custom", path: ["value"], message: `"${m.value}" isn't a division` });
    if (m.field === "POSTCODE" && !/^\d{4}$/.test(m.value)) ctx.addIssue({ code: "custom", path: ["value"], message: "A postcode has 4 digits" });
  })
  .transform((m) => ({ ...m, value: (m.field === "DISTRICT" ? DISTRICTS : m.field === "DIVISION" ? DIVISIONS : null)?.get(m.value.toLowerCase()) ?? m.value }));

const zoneFields = {
  name: z.string().trim().min(1, "Name the zone").max(60),
  priority: z.coerce.number().int().min(0).max(1000),
  isActive: z.boolean(),
  matches: z.array(shippingZoneMatchSchema).max(100),
  fee: z.coerce.number().min(0).max(100_000),
  /** Free delivery when the order's goods (after discounts) reach this; null = never. */
  freeOverAmount: z.coerce.number().min(0).max(10_000_000).nullable(),
};

/** Admin V2 DR-17: a delivery zone and its fee. */
export const createShippingZoneSchema = z.object({ ...zoneFields, priority: zoneFields.priority.default(10), isActive: zoneFields.isActive.default(true) });
export const updateShippingZoneSchema = z.object(zoneFields).partial();
export type CreateShippingZoneInput = z.infer<typeof createShippingZoneSchema>;
export type UpdateShippingZoneInput = z.infer<typeof updateShippingZoneSchema>;

export interface ShippingZoneRow {
  id: string;
  key: string;
  name: string;
  priority: number;
  isDefault: boolean;
  isActive: boolean;
  matches: Array<{ field: "DISTRICT" | "DIVISION" | "POSTCODE"; value: string }>;
  fee: number;
  freeOverAmount: number | null;
  /** Seeded zone the legacy inside/outside-Dhaka fee fields mirror — can't be deleted. */
  protected: boolean;
}
