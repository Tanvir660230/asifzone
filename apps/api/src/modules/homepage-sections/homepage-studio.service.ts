import { Prisma } from "@prisma/client";
import {
  configSchemaByType,
  REPEATABLE_SECTION_TYPES,
  storefrontDesignSchema,
  validateStorefrontDesign,
  validateStudioSections,
  type SaveStudioDraftInput,
  type StudioSection,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { invalidateHomepageSectionsCache, listHomepageSections } from "./homepage-section.service";
import { getSettings, invalidateSettingsCache, readStorefrontDesign, writeStorefrontDesign } from "../settings/settings.service";
import { DRAFT_ID, lockDraft, toStudioSection } from "./homepage-draft-lock";

/**
 * Storefront Studio: the homepage is edited as one draft document (HomepageDraft), autosaved as the admin works, and
 * applied to the live HomepageSection rows only on publish. Every save and publish names the draft version it was made
 * on; a mismatch is a 409, so two editors (or two tabs) never silently overwrite each other. The draft row is never
 * deleted — publishing or discarding empties it — so its version keeps counting and an old tab stays stale.
 */

const REVISIONS_KEPT = 20;

function staleVersion(version: number) {
  return new AppError(409, "The homepage draft was changed somewhere else — reload to get the latest.", { version });
}

async function liveDesign(): Promise<Record<string, unknown>> {
  return ((await getSettings()).storefrontDesign as Record<string, unknown> | null) ?? {};
}

export async function getStudio() {
  const [live, published, draft] = await Promise.all([
    listHomepageSections().then((rows) => rows.map(toStudioSection)),
    liveDesign(),
    prisma.homepageDraft.findUnique({ where: { id: DRAFT_ID } }),
  ]);
  const draftSections = (draft?.sections ?? null) as StudioSection[] | null;
  return {
    version: draft?.version ?? 0,
    sections: draftSections ?? live,
    design: draftSections ? ((draft!.design as Record<string, unknown> | null) ?? published) : published,
    hasDraft: draftSections !== null,
    updatedAt: draftSections ? draft!.updatedAt.toISOString() : null,
    liveSections: live,
    liveDesign: published,
  };
}

export async function saveDraft(input: SaveStudioDraftInput, adminId: string) {
  return prisma.$transaction(async (tx) => {
    // Locked, so two saves can't both pass the version check.
    const { version } = await lockDraft(tx);
    if (input.version !== version) throw staleVersion(version);
    const saved = await tx.homepageDraft.update({
      where: { id: DRAFT_ID },
      data: {
        version: version + 1,
        sections: input.sections as unknown as Prisma.InputJsonValue,
        ...(input.design !== undefined && { design: input.design as Prisma.InputJsonValue }),
        updatedById: adminId,
      },
    });
    return { version: saved.version, updatedAt: saved.updatedAt.toISOString() };
  });
}

export async function discardDraft(adminId: string) {
  await prisma.homepageDraft.updateMany({
    where: { id: DRAFT_ID },
    data: { sections: Prisma.DbNull, design: Prisma.DbNull, version: { increment: 1 }, updatedById: adminId },
  });
}

export async function publishDraft(version: number, adminId: string) {
  const published = await prisma.$transaction(async (tx) => {
    const draft = await lockDraft(tx);
    if (draft.version !== version) throw staleVersion(draft.version);
    const sections = draft.sections;
    if (!sections) throw AppError.badRequest("There are no changes to publish.");

    const errors = validateStudioSections(sections);
    const live = await tx.homepageSection.findMany();
    const draftIds = new Set(sections.map((s) => s.id));
    const liveTypes = new Map(live.map((row) => [row.id, row.type]));
    for (const section of sections) {
      const liveType = liveTypes.get(section.id);
      if (liveType && liveType !== section.type) (errors[section.id] ??= []).push("This section's type doesn't match the live page — reload the editor.");
    }
    for (const row of live) {
      if (!REPEATABLE_SECTION_TYPES.includes(row.type) && !sections.some((s) => s.type === row.type)) {
        (errors[row.id] ??= []).push("This section can't be removed — switch it off instead.");
      }
    }
    // The site design goes live with the sections; a draft that never touched it keeps the published one.
    if (draft.design) {
      for (const [group, messages] of Object.entries(validateStorefrontDesign(draft.design).groups)) errors[`design:${group}`] = messages!;
    }
    if (Object.keys(errors).length > 0) throw AppError.badRequest("Fix the highlighted sections before publishing.", errors);
    // Stored as the admin wrote it (already validated above), not zod's output — the output fills in defaults, which
    // would make an untouched group look customised next time.
    const design = draft.design && storefrontDesignSchema.safeParse(draft.design).success ? draft.design : null;
    if (design) {
      await writeStorefrontDesign(tx, design as Prisma.InputJsonValue);
    }

    await tx.homepageSection.deleteMany({ where: { id: { in: live.filter((row) => !draftIds.has(row.id)).map((row) => row.id) } } });
    const liveIds = new Set(live.map((row) => row.id));
    for (const [sortOrder, section] of sections.entries()) {
      const data = {
        sortOrder,
        isActive: section.isActive,
        config: configSchemaByType[section.type].parse(section.config) as Prisma.InputJsonValue,
        startsAt: section.startsAt ? new Date(section.startsAt) : null,
        endsAt: section.endsAt ? new Date(section.endsAt) : null,
      };
      if (liveIds.has(section.id)) await tx.homepageSection.update({ where: { id: section.id }, data });
      // New in this draft (`new-…`), or deleted from the live page since the draft was made: create it fresh.
      else await tx.homepageSection.create({ data: { type: section.type, ...data } });
    }

    const result = await tx.homepageSection.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const admin = await tx.adminUser.findUnique({ where: { id: adminId }, select: { name: true } });
    const publishedDesign = await readStorefrontDesign(tx);
    await tx.homepageRevision.create({
      data: {
        sections: result.map(toStudioSection) as unknown as Prisma.InputJsonValue,
        design: (publishedDesign ?? {}) as Prisma.InputJsonValue,
        publishedById: adminId,
        publishedByName: admin?.name ?? null,
      },
    });
    const old = await tx.homepageRevision.findMany({ orderBy: { publishedAt: "desc" }, skip: REVISIONS_KEPT, select: { id: true } });
    if (old.length) await tx.homepageRevision.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
    await tx.homepageDraft.update({ where: { id: DRAFT_ID }, data: { sections: Prisma.DbNull, design: Prisma.DbNull, version: { increment: 1 }, updatedById: adminId } });
    return { result, designChanged: Boolean(design) };
  });
  await invalidateHomepageSectionsCache();
  if (published.designChanged) await invalidateSettingsCache();
  return published.result;
}

export async function listRevisions() {
  const revisions = await prisma.homepageRevision.findMany({ orderBy: { publishedAt: "desc" }, take: REVISIONS_KEPT });
  return revisions.map((r) => ({
    id: r.id,
    publishedAt: r.publishedAt.toISOString(),
    publishedByName: r.publishedByName,
    sectionCount: Array.isArray(r.sections) ? r.sections.length : 0,
  }));
}

/** Loads a published version into the draft (it goes live only when the admin publishes again). */
export async function restoreRevision(id: string, adminId: string) {
  const revision = await prisma.homepageRevision.findUnique({ where: { id } });
  if (!revision) throw AppError.notFound("That version is no longer kept");
  await prisma.$transaction(async (tx) => {
    await lockDraft(tx);
    await tx.homepageDraft.update({
      where: { id: DRAFT_ID },
      data: {
        version: { increment: 1 },
        sections: revision.sections as Prisma.InputJsonValue,
        // Revisions from before the site design existed carry none: keep the draft on the published design then.
        design: (revision.design ?? (await liveDesign())) as Prisma.InputJsonValue,
        updatedById: adminId,
      },
    });
  });
  return getStudio();
}
