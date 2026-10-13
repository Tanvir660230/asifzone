import { Prisma, type HomepageSection } from "@prisma/client";
import type { StudioSection } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

/** The one Storefront Studio draft row. */
export const DRAFT_ID = "homepage";

type Tx = Prisma.TransactionClient;

/**
 * Locks the draft row for the rest of the transaction and returns it. The row is created first if it doesn't exist yet,
 * so the lock always has a row to hold — otherwise two first saves would both see "no draft" and both win.
 */
export async function lockDraft(tx: Tx): Promise<{ version: number; sections: StudioSection[] | null; design: Record<string, unknown> | null }> {
  await tx.$executeRaw`INSERT INTO "HomepageDraft" (id, version, "updatedAt") VALUES (${DRAFT_ID}, 0, now()) ON CONFLICT (id) DO NOTHING`;
  const [row] = await tx.$queryRaw<{ version: number; sections: StudioSection[] | null; design: Record<string, unknown> | null }[]>`
    SELECT version, sections, design FROM "HomepageDraft" WHERE id = ${DRAFT_ID} FOR UPDATE`;
  return { version: row!.version, sections: row!.sections, design: row!.design };
}

export function toStudioSection(section: HomepageSection): StudioSection {
  return {
    id: section.id,
    type: section.type,
    isActive: section.isActive,
    config: (section.config ?? {}) as Record<string, unknown>,
    startsAt: section.startsAt?.toISOString() ?? null,
    endsAt: section.endsAt?.toISOString() ?? null,
  };
}

/**
 * The older per-section routes write the live rows directly. When a Studio draft is open, the same change is applied to
 * the draft (so the next publish keeps it rather than reverting it) and the draft's version moves (so an open editor is
 * told to reload instead of saving over it). No draft open: nothing to do.
 */
export async function syncOpenDraft(change: (sections: StudioSection[]) => StudioSection[]) {
  await prisma.$transaction(async (tx) => {
    const draft = await lockDraft(tx);
    if (!draft.sections) return;
    await tx.homepageDraft.update({
      where: { id: DRAFT_ID },
      data: { sections: change(draft.sections) as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    });
  });
}

/** Puts the draft's sections that are live rows into `ids` order, in the slots they already occupy (new, unpublished
 * sections stay where the admin put them). */
export function reorderDraft(sections: StudioSection[], ids: string[]) {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const known = sections.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  let next = 0;
  return sections.map((s) => (rank.has(s.id) ? known[next++]! : s));
}
