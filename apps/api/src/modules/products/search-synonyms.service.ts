import { BUILT_IN_SYNONYM_GROUPS, createSearchExpander, type SearchExpander, type SearchSynonymInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDel, cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { recordAudit } from "../../lib/audit";
import { triggerStorefrontRevalidation } from "./product.cache";

/** Store-wide synonym groups the admin manages (Catalog → Search synonyms). Search reads them through
 * getSearchExpander(): the active groups are cached in Redis (shared by every API process) and the expander built
 * from them is memoized per process until the groups change. */
const ACTIVE_GROUPS_KEY = "search-synonyms:active";
const ACTIVE_GROUPS_TTL_SECONDS = 600;

let memo: { signature: string; expander: SearchExpander } | null = null;

async function loadActiveGroups(): Promise<string[][]> {
  const cached = await cacheGet<string[][]>(ACTIVE_GROUPS_KEY);
  if (cached) return cached;
  const rows = await prisma.searchSynonym.findMany({ where: { isActive: true }, select: { terms: true }, orderBy: { createdAt: "asc" } });
  const groups = rows.map((r) => r.terms);
  await cacheSet(ACTIVE_GROUPS_KEY, groups, ACTIVE_GROUPS_TTL_SECONDS);
  return groups;
}

/** The search expander every storefront search uses: built-in dictionary + the store's active groups. */
export async function getSearchExpander(): Promise<SearchExpander> {
  const groups = await loadActiveGroups();
  const signature = JSON.stringify(groups);
  if (memo?.signature !== signature) memo = { signature, expander: createSearchExpander(groups) };
  return memo.expander;
}

async function afterChange() {
  await cacheDel(ACTIVE_GROUPS_KEY);
  // Cached storefront search pages were expanded with the old groups.
  void triggerStorefrontRevalidation().catch(() => undefined);
}

export async function listSearchSynonyms() {
  const synonyms = await prisma.searchSynonym.findMany({ orderBy: { createdAt: "desc" } });
  return { synonyms, builtIn: BUILT_IN_SYNONYM_GROUPS };
}

export async function createSearchSynonym(input: SearchSynonymInput, adminId: string, ip?: string) {
  const synonym = await prisma.searchSynonym.create({ data: input });
  await afterChange();
  recordAudit({ adminId, action: "search_synonym.created", entityType: "search_synonyms", entityId: synonym.id, ipAddress: ip ?? null, metadata: { terms: synonym.terms } });
  return synonym;
}

export async function updateSearchSynonym(id: string, input: SearchSynonymInput, adminId: string, ip?: string) {
  const before = await prisma.searchSynonym.findUnique({ where: { id } });
  if (!before) throw AppError.notFound("Synonym group not found");
  const synonym = await prisma.searchSynonym.update({ where: { id }, data: input });
  await afterChange();
  recordAudit({
    adminId,
    action: "search_synonym.updated",
    entityType: "search_synonyms",
    entityId: id,
    ipAddress: ip ?? null,
    metadata: { from: { terms: before.terms, isActive: before.isActive }, to: { terms: synonym.terms, isActive: synonym.isActive } },
  });
  return synonym;
}

export async function deleteSearchSynonym(id: string, adminId: string, ip?: string) {
  const before = await prisma.searchSynonym.findUnique({ where: { id } });
  if (!before) throw AppError.notFound("Synonym group not found");
  await prisma.searchSynonym.delete({ where: { id } });
  await afterChange();
  recordAudit({ adminId, action: "search_synonym.deleted", entityType: "search_synonyms", entityId: id, ipAddress: ip ?? null, metadata: { terms: before.terms } });
}
