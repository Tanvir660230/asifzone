import { Prisma } from "@prisma/client";
import type {
  CareGuidePresetInput,
  CreateAttributeDefinitionInput,
  MaterialInput,
  ProductTypeInput,
  ResolvedTypeConfig,
  SizeGuidePresetInput,
  SpecGroupInput,
  TemplateInput,
  UpdateAttributeDefinitionInput,
  UpdateProductTypeInput,
} from "@clothing-brand/shared";
import { attributeTypeHasOptions, slugify } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { ensureUniqueSlug } from "../../lib/unique-slug";
import { invalidateProductCache } from "../products/product.cache";
import { TYPE_INCLUDE, toResolvedTypeConfig, type TypeWithTemplate } from "./catalog.presenter";

/** Any catalog edit changes how products of the affected types are presented (spec groups, size guide,
 * variant labels), so the cached product reads must go. */
async function afterConfigChange() {
  await invalidateProductCache();
}

function conflictOnUnique(err: unknown, message: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw AppError.conflict(message);
  throw err;
}

/* ───────────────────────── product types ───────────────────────── */

export async function getTypeWithTemplate(id: string): Promise<TypeWithTemplate> {
  const type = await prisma.productTypeDef.findUnique({ where: { id }, include: TYPE_INCLUDE });
  if (!type) throw AppError.notFound("Product type not found");
  return type;
}

export async function getTypeByKey(key: string): Promise<TypeWithTemplate | null> {
  return prisma.productTypeDef.findUnique({ where: { key }, include: TYPE_INCLUDE });
}

/** Active types with their full template — what the product editor loads. */
export async function listResolvedTypes(includeInactive = false): Promise<ResolvedTypeConfig[]> {
  const types = await prisma.productTypeDef.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: TYPE_INCLUDE,
  });
  return types.map(toResolvedTypeConfig);
}

export async function listTypesForManagement() {
  const types = await prisma.productTypeDef.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { template: { select: { id: true, name: true } }, _count: { select: { products: true } } },
  });
  return types.map(({ _count, ...t }) => ({ ...t, productCount: _count.products }));
}

async function assertValidParent(typeId: string | null, parentId: string | null | undefined) {
  if (!parentId) return;
  if (parentId === typeId) throw AppError.badRequest("A type can't be its own parent");
  // Walk up the chain: the new parent must not be a descendant of this type.
  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 10; depth++) {
    if (cursor === typeId) throw AppError.badRequest("That parent would create a loop");
    const parent: { parentId: string | null } | null = await prisma.productTypeDef.findUnique({ where: { id: cursor }, select: { parentId: true } });
    if (!parent) throw AppError.badRequest("Parent type does not exist");
    cursor = parent.parentId;
  }
}

async function assertTemplateUsable(templateId: string) {
  const template = await prisma.productTemplate.findUnique({ where: { id: templateId }, select: { isArchived: true } });
  if (!template) throw AppError.badRequest("Template does not exist");
  if (template.isArchived) throw AppError.badRequest("That template is archived");
}

export async function createType(input: ProductTypeInput) {
  await assertTemplateUsable(input.templateId);
  await assertValidParent(null, input.parentId);

  const key = await ensureUniqueSlug(input.key || slugify(input.name), async (candidate) =>
    Boolean(await prisma.productTypeDef.findUnique({ where: { key: candidate } })),
  );
  const { key: _ignored, ...data } = input;
  void _ignored;
  // Unless the admin picked an order, a new type goes to the end — the editor defaults new products to the first
  // active type, and a freshly created "Cap" must not jump ahead of Clothing just because both have order 0.
  const sortOrder = data.sortOrder || ((await prisma.productTypeDef.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0) + 1;
  try {
    const created = await prisma.productTypeDef.create({ data: { ...data, sortOrder, key, legacyType: "CUSTOM" } });
    await afterConfigChange();
    return created;
  } catch (err) {
    return conflictOnUnique(err, `A product type with key "${key}" already exists`);
  }
}

export async function updateType(id: string, input: UpdateProductTypeInput) {
  const existing = await getTypeWithTemplate(id);
  if (input.templateId && input.templateId !== existing.templateId) await assertTemplateUsable(input.templateId);
  if (input.parentId !== undefined) await assertValidParent(id, input.parentId);

  const updated = await prisma.productTypeDef.update({ where: { id }, data: input });
  await afterConfigChange();
  return updated;
}

export async function deleteType(id: string) {
  const type = await prisma.productTypeDef.findUnique({ where: { id }, include: { _count: { select: { products: true, children: true } } } });
  if (!type) throw AppError.notFound("Product type not found");
  if (type.isSystem) throw AppError.conflict("Built-in product types can't be deleted — archive it instead");
  if (type._count.products > 0) throw AppError.conflict(`${type._count.products} product(s) use this type — move them or archive the type instead`);
  if (type._count.children > 0) throw AppError.conflict("This type has child types — remove or move them first");
  await prisma.productTypeDef.delete({ where: { id } });
  await afterConfigChange();
}

/* ───────────────────────── attribute definitions ───────────────────────── */

const DEFINITION_INCLUDE = { options: { orderBy: { sortOrder: "asc" as const } } };

export async function listAttributeDefinitions() {
  const defs = await prisma.attributeDefinition.findMany({
    orderBy: [{ label: "asc" }],
    include: { ...DEFINITION_INCLUDE, _count: { select: { templates: true, values: true } } },
  });
  return defs.map(({ _count, ...d }) => ({ ...d, templateCount: _count.templates, valueCount: _count.values }));
}

async function getDefinition(id: string) {
  const def = await prisma.attributeDefinition.findUnique({ where: { id }, include: DEFINITION_INCLUDE });
  if (!def) throw AppError.notFound("Attribute not found");
  return def;
}

export async function createAttributeDefinition(input: CreateAttributeDefinitionInput) {
  const { options, ...data } = input;
  try {
    const created = await prisma.attributeDefinition.create({
      data: { ...data, options: { create: options.map((value, sortOrder) => ({ value, sortOrder })) } },
      include: DEFINITION_INCLUDE,
    });
    await afterConfigChange();
    return created;
  } catch (err) {
    return conflictOnUnique(err, `An attribute with the key "${input.key}" already exists`);
  }
}

export async function updateAttributeDefinition(id: string, input: UpdateAttributeDefinitionInput) {
  const existing = await getDefinition(id);
  const { options, ...data } = input;

  if (options !== undefined) {
    if (!attributeTypeHasOptions(existing.dataType)) throw AppError.badRequest("This attribute type has no options");
    if (options.length === 0) throw AppError.badRequest("Add at least one option");

    // An option that products are already using can't disappear — that would leave values the field
    // no longer accepts (and that the storefront would still be showing).
    const removed = existing.options.filter((o) => !options.includes(o.value)).map((o) => o.value);
    if (removed.length) {
      const inUse: string[] = [];
      for (const value of removed) {
        const used = await prisma.productAttributeValue.count({
          where:
            existing.dataType === "MULTI_SELECT"
              ? { definitionId: id, valueJson: { array_contains: [value] } }
              : { definitionId: id, valueText: value },
        });
        if (used > 0) inUse.push(value);
      }
      if (inUse.length) throw AppError.conflict(`Can't remove option(s) still used by products: ${inUse.join(", ")}`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.attributeDefinition.update({ where: { id }, data });
    if (options !== undefined) {
      await tx.attributeDefinitionOption.deleteMany({ where: { definitionId: id, value: { notIn: options } } });
      for (const [sortOrder, value] of options.entries()) {
        await tx.attributeDefinitionOption.upsert({
          where: { definitionId_value: { definitionId: id, value } },
          update: { sortOrder },
          create: { definitionId: id, value, sortOrder },
        });
      }
    }
  });
  await afterConfigChange();
  return getDefinition(id);
}

export async function deleteAttributeDefinition(id: string) {
  const def = await prisma.attributeDefinition.findUnique({ where: { id }, include: { _count: { select: { templates: true, values: true } } } });
  if (!def) throw AppError.notFound("Attribute not found");
  if (def._count.templates > 0) throw AppError.conflict("This attribute is used by a template — remove it there first, or archive it");
  if (def._count.values > 0) throw AppError.conflict("Products hold values for this attribute — archive it instead of deleting");
  await prisma.attributeDefinition.delete({ where: { id } });
  await afterConfigChange();
}

/* ───────────────────────── spec groups ───────────────────────── */

export async function listSpecGroups() {
  const groups = await prisma.specGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { items: true } } } });
  return groups.map(({ _count, ...g }) => ({ ...g, usageCount: _count.items }));
}

export async function createSpecGroup(input: SpecGroupInput) {
  try {
    const created = await prisma.specGroup.create({ data: input });
    await afterConfigChange();
    return created;
  } catch (err) {
    return conflictOnUnique(err, `A spec group named "${input.name}" already exists`);
  }
}

export async function updateSpecGroup(id: string, input: Partial<SpecGroupInput>) {
  if (!(await prisma.specGroup.findUnique({ where: { id }, select: { id: true } }))) throw AppError.notFound("Spec group not found");
  try {
    const updated = await prisma.specGroup.update({ where: { id }, data: input });
    await afterConfigChange();
    return updated;
  } catch (err) {
    return conflictOnUnique(err, `A spec group named "${input.name}" already exists`);
  }
}

/** Template attributes in the group fall back to "Specifications" (SetNull), so deleting is safe. */
export async function deleteSpecGroup(id: string) {
  if (!(await prisma.specGroup.findUnique({ where: { id }, select: { id: true } }))) throw AppError.notFound("Spec group not found");
  await prisma.specGroup.delete({ where: { id } });
  await afterConfigChange();
}

/* ───────────────────────── size guide presets ───────────────────────── */

export async function listSizeGuidePresets() {
  const presets = await prisma.sizeGuidePreset.findMany({ orderBy: [{ isArchived: "asc" }, { name: "asc" }], include: { _count: { select: { templates: true } } } });
  return presets.map(({ _count, ...p }) => ({ ...p, templateCount: _count.templates }));
}

async function getPreset(id: string) {
  const preset = await prisma.sizeGuidePreset.findUnique({ where: { id } });
  if (!preset) throw AppError.notFound("Size guide not found");
  return preset;
}

export async function createSizeGuidePreset(input: SizeGuidePresetInput) {
  try {
    const created = await prisma.sizeGuidePreset.create({ data: { ...input, columns: input.columns, rows: input.rows } });
    await afterConfigChange();
    return created;
  } catch (err) {
    return conflictOnUnique(err, `A size guide named "${input.name}" already exists`);
  }
}

export async function updateSizeGuidePreset(id: string, input: SizeGuidePresetInput & { isArchived?: boolean }) {
  await getPreset(id);
  try {
    const updated = await prisma.sizeGuidePreset.update({ where: { id }, data: input });
    await afterConfigChange();
    return updated;
  } catch (err) {
    return conflictOnUnique(err, `A size guide named "${input.name}" already exists`);
  }
}

export async function setSizeGuidePresetArchived(id: string, isArchived: boolean) {
  await getPreset(id);
  const updated = await prisma.sizeGuidePreset.update({ where: { id }, data: { isArchived } });
  await afterConfigChange();
  return updated;
}

export async function duplicateSizeGuidePreset(id: string) {
  const source = await getPreset(id);
  let name = `${source.name} copy`;
  for (let n = 2; await prisma.sizeGuidePreset.findUnique({ where: { name }, select: { id: true } }); n++) {
    name = `${source.name} copy ${n}`;
  }
  const created = await prisma.sizeGuidePreset.create({
    data: {
      name,
      description: source.description,
      unit: source.unit,
      notes: source.notes,
      columns: source.columns as Prisma.InputJsonValue,
      rows: source.rows as Prisma.InputJsonValue,
    },
  });
  return created;
}

export async function deleteSizeGuidePreset(id: string) {
  const preset = await prisma.sizeGuidePreset.findUnique({ where: { id }, include: { _count: { select: { templates: true } } } });
  if (!preset) throw AppError.notFound("Size guide not found");
  if (preset._count.templates > 0) throw AppError.conflict("This size guide is used by a template — archive it instead of deleting");
  await prisma.sizeGuidePreset.delete({ where: { id } });
  await afterConfigChange();
}

/* ───────────────────────── templates ───────────────────────── */

const TEMPLATE_INCLUDE = {
  sizeGuidePreset: { select: { id: true, name: true } },
  carePreset: { select: { id: true, name: true } },
  attributes: {
    orderBy: { sortOrder: "asc" as const },
    include: { definition: { select: { id: true, key: true, label: true, dataType: true, isArchived: true } }, specGroup: { select: { id: true, name: true } } },
  },
  _count: { select: { types: true } },
};

export async function listTemplates() {
  const templates = await prisma.productTemplate.findMany({ orderBy: [{ isArchived: "asc" }, { name: "asc" }], include: TEMPLATE_INCLUDE });
  return templates.map(({ _count, ...t }) => ({ ...t, typeCount: _count.types }));
}

export async function getTemplate(id: string) {
  const template = await prisma.productTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE });
  if (!template) throw AppError.notFound("Template not found");
  const { _count, ...rest } = template;
  return { ...rest, typeCount: _count.types };
}

/** Rejects references that don't exist (or that were archived since) before anything is written. */
async function assertTemplateReferences(
  input: Partial<TemplateInput>,
  current?: { attributeIds: string[]; presetId: string | null; carePresetId: string | null },
) {
  if (input.attributes?.length) {
    const ids = input.attributes.map((a) => a.definitionId);
    const defs = await prisma.attributeDefinition.findMany({ where: { id: { in: ids } }, select: { id: true, label: true, isArchived: true } });
    const found = new Map(defs.map((d) => [d.id, d]));
    for (const id of ids) {
      const def = found.get(id);
      if (!def) throw AppError.badRequest("One of the selected attributes no longer exists");
      // Keeping an already-attached archived attribute is fine; adding a new one is not.
      if (def.isArchived && !current?.attributeIds.includes(id)) throw AppError.badRequest(`"${def.label}" is archived`);
    }
    const groupIds = [...new Set(input.attributes.map((a) => a.specGroupId).filter((g): g is string => Boolean(g)))];
    if (groupIds.length) {
      const count = await prisma.specGroup.count({ where: { id: { in: groupIds } } });
      if (count !== groupIds.length) throw AppError.badRequest("One of the selected spec groups no longer exists");
    }
  }
  if (input.sizeGuidePresetId) {
    const preset = await prisma.sizeGuidePreset.findUnique({ where: { id: input.sizeGuidePresetId }, select: { isArchived: true } });
    if (!preset) throw AppError.badRequest("Size guide does not exist");
    if (preset.isArchived && current?.presetId !== input.sizeGuidePresetId) throw AppError.badRequest("That size guide is archived");
  }
  if (input.carePresetId) {
    const preset = await prisma.careGuidePreset.findUnique({ where: { id: input.carePresetId }, select: { isArchived: true } });
    if (!preset) throw AppError.badRequest("Care guide does not exist");
    if (preset.isArchived && current?.carePresetId !== input.carePresetId) throw AppError.badRequest("That care guide is archived");
  }
}

export async function createTemplate(input: TemplateInput) {
  await assertTemplateReferences(input);
  const { attributes, ...data } = input;
  try {
    const created = await prisma.productTemplate.create({
      data: {
        ...data,
        variantDimensions: data.variantDimensions as Prisma.InputJsonValue,
        attributes: { create: attributes.map((a, sortOrder) => ({ ...a, sortOrder })) },
      },
    });
    await afterConfigChange();
    return getTemplate(created.id);
  } catch (err) {
    return conflictOnUnique(err, `A template named "${input.name}" already exists`);
  }
}

export async function updateTemplate(id: string, input: Partial<TemplateInput>) {
  const existing = await getTemplate(id);
  await assertTemplateReferences(input, {
    attributeIds: existing.attributes.map((a) => a.definitionId),
    presetId: existing.sizeGuidePresetId,
    carePresetId: existing.carePresetId,
  });

  const { attributes, variantDimensions, ...data } = input;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.productTemplate.update({
        where: { id },
        data: { ...data, ...(variantDimensions !== undefined ? { variantDimensions: variantDimensions as Prisma.InputJsonValue } : {}) },
      });
      if (attributes) {
        // Values already saved on products stay in the database: removing a field from a template only
        // hides it, so re-adding it later brings the data back.
        await tx.templateAttribute.deleteMany({ where: { templateId: id, definitionId: { notIn: attributes.map((a) => a.definitionId) } } });
        for (const [sortOrder, a] of attributes.entries()) {
          await tx.templateAttribute.upsert({
            where: { templateId_definitionId: { templateId: id, definitionId: a.definitionId } },
            update: { ...a, sortOrder },
            create: { ...a, templateId: id, sortOrder },
          });
        }
      }
    });
  } catch (err) {
    return conflictOnUnique(err, `A template named "${input.name}" already exists`);
  }
  await afterConfigChange();
  return getTemplate(id);
}

export async function deleteTemplate(id: string) {
  const template = await getTemplate(id);
  if (template.typeCount > 0) throw AppError.conflict("Product types use this template — archive it instead of deleting");
  await prisma.productTemplate.delete({ where: { id } });
  await afterConfigChange();
}

/* ───────────────────────── care guide presets ───────────────────────── */

export async function listCareGuides() {
  const presets = await prisma.careGuidePreset.findMany({
    orderBy: [{ isArchived: "asc" }, { name: "asc" }],
    include: { _count: { select: { templates: true, products: true } } },
  });
  return presets.map(({ _count, ...p }) => ({ ...p, templateCount: _count.templates, productCount: _count.products }));
}

async function getCareGuide(id: string) {
  const preset = await prisma.careGuidePreset.findUnique({ where: { id } });
  if (!preset) throw AppError.notFound("Care guide not found");
  return preset;
}

export async function createCareGuide(input: CareGuidePresetInput) {
  try {
    const created = await prisma.careGuidePreset.create({ data: { ...input, steps: input.steps } });
    await afterConfigChange();
    return created;
  } catch (err) {
    return conflictOnUnique(err, `A care guide named "${input.name}" already exists`);
  }
}

export async function updateCareGuide(id: string, input: CareGuidePresetInput) {
  await getCareGuide(id);
  try {
    const updated = await prisma.careGuidePreset.update({ where: { id }, data: input });
    await afterConfigChange();
    return updated;
  } catch (err) {
    return conflictOnUnique(err, `A care guide named "${input.name}" already exists`);
  }
}

export async function setCareGuideArchived(id: string, isArchived: boolean) {
  await getCareGuide(id);
  const updated = await prisma.careGuidePreset.update({ where: { id }, data: { isArchived } });
  await afterConfigChange();
  return updated;
}

export async function duplicateCareGuide(id: string) {
  const source = await getCareGuide(id);
  let name = `${source.name} copy`;
  for (let n = 2; await prisma.careGuidePreset.findUnique({ where: { name }, select: { id: true } }); n++) name = `${source.name} copy ${n}`;
  return prisma.careGuidePreset.create({
    data: { name, description: source.description, steps: source.steps as Prisma.InputJsonValue },
  });
}

/** Templates and products that use it fall back (SetNull) to no preset, so deleting only needs the user's confirmation. */
export async function deleteCareGuide(id: string) {
  await getCareGuide(id);
  await prisma.careGuidePreset.delete({ where: { id } });
  await afterConfigChange();
}

/* ───────────────────────── materials ───────────────────────── */

export async function listMaterials() {
  const materials = await prisma.material.findMany({
    orderBy: [{ isArchived: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });
  return materials.map(({ _count, ...m }) => ({ ...m, productCount: _count.products }));
}

export async function createMaterial(input: MaterialInput) {
  try {
    return await prisma.material.create({ data: input });
  } catch (err) {
    return conflictOnUnique(err, `A material named "${input.name}" already exists`);
  }
}

export async function updateMaterial(id: string, input: MaterialInput & { isArchived?: boolean }) {
  if (!(await prisma.material.findUnique({ where: { id }, select: { id: true } }))) throw AppError.notFound("Material not found");
  try {
    const updated = await prisma.material.update({ where: { id }, data: input });
    await afterConfigChange();
    return updated;
  } catch (err) {
    return conflictOnUnique(err, `A material named "${input.name}" already exists`);
  }
}

export async function deleteMaterial(id: string) {
  const material = await prisma.material.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
  if (!material) throw AppError.notFound("Material not found");
  if (material._count.products > 0) throw AppError.conflict(`${material._count.products} product(s) use this material — archive it instead of deleting`);
  await prisma.material.delete({ where: { id } });
}
