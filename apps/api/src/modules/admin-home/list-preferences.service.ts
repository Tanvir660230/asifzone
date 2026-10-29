import { listPreferencesSchema, type ListPreferences } from "@clothing-brand/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";

/** Every list's stored preferences for one admin, keyed by list key. A malformed entry reads as "defaults". */
async function readAll(adminId: string): Promise<Record<string, unknown>> {
  const row = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { listPreferences: true } });
  const value = row?.listPreferences;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** This admin's display preferences for one list (Order Operations plan M10); `{}` = the list's defaults. */
export async function getListPreferences(adminId: string, listKey: string): Promise<ListPreferences> {
  const parsed = listPreferencesSchema.safeParse((await readAll(adminId))[listKey] ?? {});
  return parsed.success ? parsed.data : {};
}

/** Merge a change into one list's preferences — other lists' entries are untouched. */
export async function updateListPreferences(adminId: string, listKey: string, patch: ListPreferences): Promise<ListPreferences> {
  const all = await readAll(adminId);
  const next = { ...(await getListPreferences(adminId, listKey)), ...patch };
  await prisma.adminUser.update({ where: { id: adminId }, data: { listPreferences: { ...all, [listKey]: next } as Prisma.InputJsonObject } });
  return next;
}
