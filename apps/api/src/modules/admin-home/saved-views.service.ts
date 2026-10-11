import { SAVED_VIEWS_PER_LIST, type CreateSavedViewInput, type SavedViewRow } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";

const SELECT = { id: true, adminId: true, listKey: true, label: true, query: true, shared: true, admin: { select: { name: true } } } as const;

function toRow(v: { id: string; adminId: string; listKey: string; label: string; query: string; shared: boolean; admin: { name: string } | null }, adminId: string): SavedViewRow {
  return { id: v.id, listKey: v.listKey, label: v.label, query: v.query, shared: v.shared, mine: v.adminId === adminId, createdBy: v.admin?.name ?? null };
}

/** Admin V2 DR-18: this admin's views of one list plus the team's shared ones — own first, each in creation order. */
export async function listSavedViews(adminId: string, listKey: string): Promise<SavedViewRow[]> {
  const rows = await prisma.savedView.findMany({
    where: { listKey, OR: [{ adminId }, { shared: true }] },
    orderBy: { createdAt: "asc" },
    select: SELECT,
  });
  return rows.map((r) => toRow(r, adminId)).sort((a, b) => Number(b.mine) - Number(a.mine));
}

export async function createSavedView(adminId: string, input: CreateSavedViewInput): Promise<SavedViewRow> {
  const count = await prisma.savedView.count({ where: { adminId, listKey: input.listKey } });
  if (count >= SAVED_VIEWS_PER_LIST) throw AppError.badRequest(`You can keep up to ${SAVED_VIEWS_PER_LIST} views per list — delete one first`, { code: "SAVED_VIEW_LIMIT" });
  const view = await prisma.savedView.create({
    data: { adminId, listKey: input.listKey, label: input.label, query: input.query, shared: input.shared ?? false },
    select: SELECT,
  });
  return toRow(view, adminId);
}

/** Only the creator deletes a view (a shared view stays until its owner removes it). */
export async function deleteSavedView(adminId: string, id: string) {
  const { count } = await prisma.savedView.deleteMany({ where: { id, adminId } });
  if (count === 0) throw AppError.notFound("View not found");
}
