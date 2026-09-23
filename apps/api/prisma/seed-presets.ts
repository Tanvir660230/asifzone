/// <reference types="node" />
/**
 * Optional, idempotent starter data for the catalog — run it yourself when you want it: `pnpm --filter api db:seed:presets`.
 * Nothing runs it automatically (not the migrations, not `db:seed`, not the deploy).
 *
 * It adds what a clothing / accessories shop usually wants on day one, through the same service functions the admin screens
 * use (so it is validated exactly like hand-made data):
 *   - care guides (Cotton, Leather, Shoe, Watch), reusable materials, and a Cap size guide;
 *   - the missing attribute definitions, and two new product types: Panjabi and Cap (each with its template);
 *   - the extra optional fields the Watch and Shoes types lacked (dial size, case/strap material, glass; shoe type, sole material),
 *     added to their templates, and a default care guide for both.
 * It only ever adds: it never edits or removes an existing row, never touches products, and running it twice changes nothing.
 * Everything can still be edited or archived in Catalog setup afterwards.
 */
import { PrismaClient } from "@prisma/client";
import {
  type AttributeDataType,
  createAttributeDefinitionSchema,
  careGuidePresetSchema,
  materialSchema,
  productTypeSchema,
  sizeGuidePresetSchema,
  templateSchema,
} from "@clothing-brand/shared";
import {
  createAttributeDefinition,
  createCareGuide,
  createMaterial,
  createSizeGuidePreset,
  createTemplate,
  createType,
  getTemplate,
  updateTemplate,
} from "../src/modules/catalog/catalog.service";

const prisma = new PrismaClient();
const done = { created: [] as string[], skipped: [] as string[] };
const made = (what: string) => done.created.push(what);
const had = (what: string) => done.skipped.push(what);

async function ensureAttribute(key: string, spec: { label: string; dataType: AttributeDataType; options?: string[]; unit?: string }) {
  const existing = await prisma.attributeDefinition.findUnique({ where: { key } });
  if (existing) return had(`attribute ${key}`), existing.id;
  const created = await createAttributeDefinition(createAttributeDefinitionSchema.parse({ key, ...spec }));
  made(`attribute ${key}`);
  return created.id;
}

/** An attribute the migration already seeded (material, fit, fabric …); the presets reuse it rather than inventing a twin. */
async function existingAttribute(key: string) {
  const row = await prisma.attributeDefinition.findUnique({ where: { key } });
  if (!row) throw new Error(`Expected the built-in attribute "${key}" — has the catalog migration been applied?`);
  return row.id;
}

async function ensureCareGuide(name: string, steps: string[]) {
  const existing = await prisma.careGuidePreset.findFirst({ where: { name } });
  if (existing) return had(`care guide ${name}`), existing.id;
  const created = await createCareGuide(careGuidePresetSchema.parse({ name, steps }));
  made(`care guide ${name}`);
  return created.id;
}

async function ensureMaterial(name: string) {
  if (await prisma.material.findFirst({ where: { name } })) return had(`material ${name}`);
  await createMaterial(materialSchema.parse({ name }));
  made(`material ${name}`);
}

async function ensureSizeGuide(input: { name: string } & Record<string, unknown>) {
  const existing = await prisma.sizeGuidePreset.findFirst({ where: { name: input.name } });
  if (existing) return had(`size guide ${input.name}`), existing.id;
  const created = await createSizeGuidePreset(sizeGuidePresetSchema.parse(input));
  made(`size guide ${input.name}`);
  return created.id;
}

async function ensureTypeWithTemplate(spec: { name: string; skuCode: string; description: string; template: { name: string } & Record<string, unknown> }) {
  const key = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (await prisma.productTypeDef.findUnique({ where: { key } })) return had(`type ${spec.name}`);
  let template = await prisma.productTemplate.findUnique({ where: { name: spec.template.name } });
  if (!template) {
    template = await createTemplate(templateSchema.parse(spec.template));
    made(`template ${spec.template.name}`);
  }
  await createType(productTypeSchema.parse({ name: spec.name, key, description: spec.description, templateId: template.id, skuCode: spec.skuCode }));
  made(`type ${spec.name}`);
}

/** Adds attributes a built-in template doesn't have yet (as optional fields, after the existing ones) and a default care guide. */
async function extendBuiltInTemplate(typeKey: string, attributeIds: string[], careGuideId: string) {
  const type = await prisma.productTypeDef.findUnique({ where: { key: typeKey }, select: { templateId: true } });
  if (!type) return had(`built-in type ${typeKey} (not present)`);
  const template = await getTemplate(type.templateId);
  const attached = new Set(template.attributes.map((a) => a.definitionId));
  const missing = attributeIds.filter((id) => !attached.has(id));
  const needsCare = !template.carePresetId;
  if (!missing.length && !needsCare) return had(`${typeKey} template already extended`);
  await updateTemplate(template.id, {
    ...(missing.length
      ? {
          attributes: [
            ...template.attributes.map((a) => ({ definitionId: a.definitionId, required: a.required, specGroupId: a.specGroupId, placeholder: a.placeholder, showOnStorefront: a.showOnStorefront })),
            ...missing.map((definitionId) => ({ definitionId, required: false, showOnStorefront: true })),
          ],
        }
      : {}),
    ...(needsCare ? { carePresetId: careGuideId } : {}),
  });
  made(`${typeKey} template: +${missing.length} field(s)${needsCare ? ", default care guide" : ""}`);
}

async function main() {
  // Care guides.
  const cotton = await ensureCareGuide("Cotton Care", ["Machine wash cold with similar colours", "Do not bleach", "Tumble dry low or line dry", "Iron on medium heat", "Do not dry clean unless the label says so"]);
  await ensureCareGuide("Leather Care", ["Wipe with a soft dry cloth", "Keep away from water and direct heat", "Condition with a leather balm every few months", "Store in a cool, dry place away from sunlight"]);
  const shoeCare = await ensureCareGuide("Shoe Care", ["Brush off dust and dirt after wear", "Clean with a damp cloth and mild soap", "Let them air-dry away from direct heat", "Use shoe trees or paper to keep their shape", "Rotate pairs so each can rest between wears"]);
  const watchCare = await ensureCareGuide("Watch Care", ["Keep away from strong magnets and extreme heat", "Rinse with fresh water after salt-water use and dry it", "Wipe the case and strap with a soft cloth", "Have the seals checked every 1–2 years", "Only wind or set the crown while the watch is dry"]);

  // Materials (a product can list several, with percentages).
  for (const name of ["Premium Cotton", "100% Cotton", "Linen", "Cotton Blend", "Genuine Leather", "Synthetic Leather", "Stainless Steel", "Sapphire Crystal", "Mineral Glass"]) await ensureMaterial(name);

  // Size guide for caps (the apparel and shoe guides come with the catalog migration).
  const capGuide = await ensureSizeGuide({
    name: "Cap size guide",
    unit: "cm",
    columns: ["Size", "Head circumference"],
    rows: [["S", "54–56"], ["M", "56–58"], ["L", "58–60"], ["XL", "60–62"]],
  });
  const apparelGuide = (await prisma.sizeGuidePreset.findFirst({ where: { name: "Apparel size guide" } }))?.id ?? null;

  // Attributes.
  const collar = await ensureAttribute("collar", { label: "Collar", dataType: "SELECT", options: ["Band", "Mandarin", "Spread", "Round neck", "No collar"] });
  const sleeve = await ensureAttribute("sleeve", { label: "Sleeve", dataType: "SELECT", options: ["Full sleeve", "Half sleeve", "Three-quarter", "Sleeveless"] });
  const pattern = await ensureAttribute("pattern", { label: "Pattern", dataType: "SELECT", options: ["Solid", "Embroidered", "Printed", "Striped", "Checked", "Jacquard"] });
  const closure = await ensureAttribute("closureType", { label: "Closure Type", dataType: "SELECT", options: ["Snapback", "Strap and buckle", "Velcro", "Elastic", "Fitted"] });
  const adjustable = await ensureAttribute("adjustable", { label: "Adjustable", dataType: "BOOLEAN" });
  const dialSize = await ensureAttribute("dialSize", { label: "Dial Size", dataType: "MEASUREMENT", unit: "mm" });
  const caseMaterial = await ensureAttribute("caseMaterial", { label: "Case Material", dataType: "SELECT", options: ["Stainless Steel", "Titanium", "Ceramic", "Brass", "Resin"] });
  const strapMaterial = await ensureAttribute("strapMaterial", { label: "Strap Material", dataType: "SELECT", options: ["Genuine Leather", "Stainless Steel", "Silicone", "Nylon", "Rubber"] });
  const glass = await ensureAttribute("glass", { label: "Glass", dataType: "SELECT", options: ["Sapphire Crystal", "Mineral Glass", "Acrylic"] });
  const shoeType = await ensureAttribute("shoeType", { label: "Shoe Type", dataType: "SELECT", options: ["Sneaker", "Loafer", "Boot", "Sandal", "Formal", "Slipper"] });
  const soleMaterial = await ensureAttribute("soleMaterial", { label: "Sole Material", dataType: "SELECT", options: ["Rubber", "EVA", "Leather", "PU", "TPR"] });

  const [material, fabric, fit] = await Promise.all([existingAttribute("material"), existingAttribute("fabric"), existingAttribute("fit")]);

  // New product types: Panjabi and Cap.
  await ensureTypeWithTemplate({
    name: "Panjabi",
    skuCode: "PNJ",
    description: "Panjabi and kurta: size and colour variants, an apparel size guide, cotton care.",
    template: {
      name: "Panjabi template",
      variantDimensions: [
        { targetField: "size", label: "Size", options: ["S", "M", "L", "XL", "XXL"] },
        { targetField: "color", label: "Colour", options: [] },
      ],
      sizeGuideMode: "ON_BY_DEFAULT",
      sizeGuidePresetId: apparelGuide,
      carePresetId: cotton,
      attributes: [material, fabric, fit, collar, sleeve, pattern].map((definitionId) => ({ definitionId, required: false, showOnStorefront: true })),
    },
  });
  await ensureTypeWithTemplate({
    name: "Cap",
    skuCode: "CAP",
    description: "Caps and hats: a cap size, its own size guide, closure type.",
    template: {
      name: "Cap template",
      variantDimensions: [
        { targetField: "size", label: "Cap size", options: ["S", "M", "L", "XL"] },
        { targetField: "color", label: "Colour", options: [] },
      ],
      sizeGuideMode: "ON_BY_DEFAULT",
      sizeGuidePresetId: capGuide,
      carePresetId: cotton,
      attributes: [material, closure, adjustable].map((definitionId) => ({ definitionId, required: false, showOnStorefront: true })),
    },
  });

  // The two built-in types the brief describes in more detail.
  await extendBuiltInTemplate("WATCH", [dialSize, caseMaterial, strapMaterial, glass], watchCare);
  await extendBuiltInTemplate("SHOES", [shoeType, soleMaterial, fit], shoeCare);

  console.log(`Created (${done.created.length}):\n  ${done.created.join("\n  ") || "nothing — already up to date"}`);
  console.log(`Already there (${done.skipped.length}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // The catalog service pulls in the cache client, which would keep a one-shot script alive waiting on Redis.
    process.exit(process.exitCode ?? 0);
  });
