import type { CreateAttributeInput, UpdateAttributeInput } from "@clothing-brand/shared";
import { slugify } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { ensureUniqueSlug } from "../../lib/unique-slug";

const include = { values: { orderBy: { sortOrder: "asc" as const } } };

export async function listAttributes() {
  return prisma.attribute.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include });
}

export async function getAttributeById(id: string) {
  const attribute = await prisma.attribute.findUnique({ where: { id }, include });
  if (!attribute) throw AppError.notFound("Attribute not found");
  return attribute;
}

export async function createAttribute(input: CreateAttributeInput) {
  const nameTaken = await prisma.attribute.findUnique({ where: { name: input.name } });
  if (nameTaken) throw AppError.conflict(`An attribute named "${input.name}" already exists`);

  const baseSlug = slugify(input.slug || input.name);
  const slug = await ensureUniqueSlug(baseSlug, async (candidate) => {
    return Boolean(await prisma.attribute.findUnique({ where: { slug: candidate } }));
  });

  const { values, ...data } = input;

  const attribute = await prisma.attribute.create({
    data: { ...data, slug, values: { create: values } },
    include,
  });
  return attribute;
}

export async function updateAttribute(id: string, input: UpdateAttributeInput) {
  const existing = await getAttributeById(id);

  if (input.name) {
    const nameTaken = await prisma.attribute.findFirst({ where: { name: input.name, NOT: { id } } });
    if (nameTaken) throw AppError.conflict(`An attribute named "${input.name}" already exists`);
  }

  const data: Record<string, unknown> = { ...input };
  delete data.values;

  if (input.name && !input.slug) {
    data.slug = await ensureUniqueSlug(slugify(input.name), async (candidate) => {
      return Boolean(await prisma.attribute.findFirst({ where: { slug: candidate, NOT: { id } } }));
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.attribute.update({ where: { id }, data });

    if (input.values) {
      const incomingIds = new Set(input.values.filter((v) => v.id).map((v) => v.id!));
      const toDelete = existing.values.filter((v) => !incomingIds.has(v.id));

      if (toDelete.length) {
        await tx.attributeValue.deleteMany({ where: { id: { in: toDelete.map((v) => v.id) } } });
      }

      for (const value of input.values) {
        if (value.id) {
          await tx.attributeValue.update({ where: { id: value.id }, data: value });
        } else {
          await tx.attributeValue.create({ data: { ...value, attributeId: id } });
        }
      }
    }
  });

  return getAttributeById(id);
}

export async function deleteAttribute(id: string) {
  const attribute = await getAttributeById(id);

  const usedValueCount = await prisma.variantAttributeValue.count({
    where: { attributeValueId: { in: attribute.values.map((v) => v.id) } },
  });
  if (usedValueCount > 0) {
    throw AppError.conflict("Cannot delete an attribute that is still used on product variants");
  }

  await prisma.attribute.delete({ where: { id } });
}
