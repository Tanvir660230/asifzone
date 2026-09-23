import { isBlankAttributeValue, type ResolvedAttributeField, type SpecItemView } from "./schemas/catalog";

/** Grouping used for fields an admin left out of any spec group. */
export const DEFAULT_SPEC_GROUP_NAME = "Specifications";

/** Pure: groups a type's fields (in template order) into the spec-group rows the product page renders.
 * The API's presenter calls this on a saved product's resolved attributes; the admin wizard's live preview
 * calls the same function on the in-progress form's `fields`/`attributes` — same rule, no drift. */
export function buildSpecGroups(fields: ResolvedAttributeField[], attributes: Record<string, unknown>): { name: string; items: SpecItemView[] }[] {
  const groups = new Map<string, SpecItemView[]>();
  for (const field of fields) {
    if (!field.showOnStorefront) continue;
    const value = attributes[field.key];
    if (isBlankAttributeValue(value)) continue;
    const name = field.specGroupName ?? DEFAULT_SPEC_GROUP_NAME;
    const items = groups.get(name) ?? [];
    items.push({ key: field.key, label: field.label, dataType: field.dataType, unit: field.unit, value: value as SpecItemView["value"] });
    groups.set(name, items);
  }
  // Groups appear in the order their first field appears in the template.
  return [...groups.entries()].map(([name, items]) => ({ name, items }));
}
