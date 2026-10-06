import { normalizeMediaReferences } from "@clothing-brand/shared";
import type { AppPrismaClient } from "../config/prisma";

/**
 * Media-reference normalization (Phase 1B, docs/STORE_DEPLOYMENT.md "Media"): rewrites legacy ABSOLUTE upload URLs
 * (`https://shop.example.com/uploads/…`) to the domain-free reference (`/uploads/…`) in every text, JSON and text-array
 * column of the database, so the data no longer names the domain it was uploaded on.
 *
 * Controlled and reversible:
 *   - only the hosts passed in are rewritten (a third party's `/uploads/` link is never touched);
 *   - `planMediaNormalization` only reads — run it first (the script's default dry run) and review the summary;
 *   - `applyMediaNormalization` writes every change in ONE transaction, each row guarded by its current value
 *     (compare-and-set: a row edited since the plan is skipped, never overwritten), and returns the before/after of each
 *     changed cell — the script saves that as the backup file;
 *   - `revertMediaNormalization` puts the `before` values back, again only where the cell still holds the `after` value.
 * Rendering never depends on this having run: the resolver already reads legacy absolute URLs (media.ts).
 */

type Db = Pick<AppPrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe" | "$transaction">;

type Kind = "text" | "json" | "jsonb" | "array";

interface Column {
  table: string;
  column: string;
  kind: Kind;
  primaryKey: string[];
}

export interface MediaChange {
  table: string;
  column: string;
  kind: Kind;
  /** Primary-key values of the row, as text, in `primaryKey` order. */
  key: Record<string, string>;
  /** The cell before and after, as text (JSON text for json/jsonb/array cells). */
  before: string;
  after: string;
}

export interface MediaNormalizationPlan {
  hosts: string[];
  changes: MediaChange[];
  /** `table.column` → number of rows that would change. */
  summary: Record<string, number>;
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

function hostPattern(hosts: readonly string[]): string {
  const alternatives = hosts.map((h) => h.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  return `https?://(${alternatives.join("|")})/uploads/`;
}

async function mediaColumns(db: Db): Promise<Column[]> {
  const rows = await db.$queryRawUnsafe<{ table_name: string; column_name: string; data_type: string; udt_name: string }[]>(
    `SELECT c.table_name, c.column_name, c.data_type, c.udt_name
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = current_schema() AND c.table_name <> '_prisma_migrations'
        AND (c.data_type IN ('text', 'character varying', 'json', 'jsonb') OR c.udt_name IN ('_text', '_varchar'))
      ORDER BY c.table_name, c.column_name`,
  );
  const keys = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      WHERE tc.table_schema = current_schema() AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY tc.table_name, kcu.ordinal_position`,
  );
  const primaryKeys = new Map<string, string[]>();
  for (const k of keys) primaryKeys.set(k.table_name, [...(primaryKeys.get(k.table_name) ?? []), k.column_name]);
  return rows
    .filter((r) => (primaryKeys.get(r.table_name) ?? []).length > 0)
    .map((r) => ({
      table: r.table_name,
      column: r.column_name,
      kind: r.udt_name.startsWith("_") ? "array" : r.data_type === "jsonb" ? "jsonb" : r.data_type === "json" ? "json" : "text",
      primaryKey: primaryKeys.get(r.table_name)!,
    }));
}

/** The cell as comparable text: JSON text for arrays (so element boundaries survive), plain text otherwise. */
function cellText(column: Column): string {
  const c = quoteIdent(column.column);
  return column.kind === "array" ? `to_json(${c})::text` : `${c}::text`;
}

/** SQL turning the text form back into the column's own type. */
function castBack(column: Column, placeholder: string): string {
  if (column.kind === "array") return `ARRAY(SELECT json_array_elements_text(${placeholder}::json))`;
  if (column.kind === "json") return `${placeholder}::json`;
  if (column.kind === "jsonb") return `${placeholder}::jsonb`;
  return placeholder;
}

/** Read-only: every cell that would change, without changing anything. */
export async function planMediaNormalization(db: Db, hosts: readonly string[]): Promise<MediaNormalizationPlan> {
  const cleanHosts = [...new Set(hosts.map((h) => h.trim().toLowerCase()).filter(Boolean))];
  if (cleanHosts.length === 0) throw new Error("[media] pass at least one host whose /uploads/ URLs belong to this installation");
  const pattern = hostPattern(cleanHosts);
  const changes: MediaChange[] = [];
  const summary: Record<string, number> = {};

  for (const column of await mediaColumns(db)) {
    const keySelect = column.primaryKey.map((k, i) => `${quoteIdent(k)}::text AS k${i}`).join(", ");
    const rows = await db.$queryRawUnsafe<Record<string, string>[]>(
      `SELECT ${keySelect}, ${cellText(column)} AS v FROM ${quoteIdent(column.table)} WHERE ${cellText(column)} ~* $1`,
      pattern,
    );
    for (const row of rows) {
      const before = row.v!;
      // Text, JSON text and the JSON form of arrays alike: only the `scheme://host` in front of `/uploads/` is removed, so the
      // value stays valid in its own type.
      const after = normalizeMediaReferences(before, cleanHosts);
      if (after === before) continue;
      const key = Object.fromEntries(column.primaryKey.map((k, i) => [k, row[`k${i}`]!]));
      changes.push({ table: column.table, column: column.column, kind: column.kind, key, before, after });
      summary[`${column.table}.${column.column}`] = (summary[`${column.table}.${column.column}`] ?? 0) + 1;
    }
  }
  return { hosts: cleanHosts, changes, summary };
}

async function writeCells(db: Db, changes: MediaChange[], direction: "apply" | "revert"): Promise<{ written: MediaChange[]; skipped: MediaChange[] }> {
  return db.$transaction(
    async (tx) => {
      const written: MediaChange[] = [];
      const skipped: MediaChange[] = [];
      for (const change of changes) {
        const column: Column = { table: change.table, column: change.column, kind: change.kind, primaryKey: Object.keys(change.key) };
        const [from, to] = direction === "apply" ? [change.before, change.after] : [change.after, change.before];
        const keyValues = Object.values(change.key);
        const keyWhere = column.primaryKey.map((k, i) => `${quoteIdent(k)}::text = $${i + 3}`).join(" AND ");
        const count = await tx.$executeRawUnsafe(
          `UPDATE ${quoteIdent(change.table)} SET ${quoteIdent(change.column)} = ${castBack(column, "$1")} ` +
            `WHERE ${keyWhere} AND ${cellText(column)} = $2`,
          to,
          from,
          ...keyValues,
        );
        (count === 1 ? written : skipped).push(change);
      }
      return { written, skipped };
    },
    { timeout: 10 * 60_000, maxWait: 30_000 },
  );
}

/** Writes the plan in one transaction. Returns what was written (the backup to keep) and any rows skipped because they
 * changed since the plan was taken. */
export function applyMediaNormalization(db: Db, plan: MediaNormalizationPlan) {
  return writeCells(db, plan.changes, "apply");
}

/** Restores the `before` values of a backup, only where a cell still holds the value the apply wrote. */
export function revertMediaNormalization(db: Db, backup: MediaChange[]) {
  return writeCells(db, backup, "revert");
}
