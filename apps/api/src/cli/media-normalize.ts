/**
 * Media-reference normalization (Phase 1B, docs/STORE_DEPLOYMENT.md "Media"). Rewrites legacy absolute upload URLs on
 * the hosts you name to the domain-free `/uploads/…` reference, in every text/JSON/text-array column. Dry run by default.
 *   pnpm --filter api media:normalize --hosts shop.example.com,www.shop.example.com            # report only
 *   pnpm --filter api media:normalize --hosts shop.example.com,www.shop.example.com --apply    # write; saves a backup
 *   pnpm --filter api media:normalize --revert backups/media-normalize-<time>.json             # put the backup back
 * In production it is compiled into the api image: `node dist/cli/media-normalize.js …` (docs/STORE_DEPLOYMENT.md).
 * Take a database backup first (docker/deploy.sh does one on every deploy). Rendering does not depend on this having run.
 */
import "../config/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prisma } from "../config/prisma";
import { applyMediaNormalization, planMediaNormalization, revertMediaNormalization, type MediaChange } from "../lib/media-normalization";

// Operator output goes straight to the terminal (stdout for the report, stderr for a failure) — not the JSON logger.
const say = (line: string) => process.stdout.write(`${line}
`);

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

(async () => {
  const revertFile = arg("--revert");
  if (revertFile) {
    const backup = JSON.parse(readFileSync(revertFile, "utf8")) as { changes: MediaChange[] };
    const { written, skipped } = await revertMediaNormalization(prisma, backup.changes);
    say(`[media] reverted ${written.length} cell(s); ${skipped.length} skipped (edited since the apply — left as they are)`);
    return;
  }

  const hosts = (arg("--hosts") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (hosts.length === 0) throw new Error("pass --hosts host1,host2 (the domains/IPs this installation's uploads were served from)");
  const plan = await planMediaNormalization(prisma, hosts);
  say(`[media] hosts: ${plan.hosts.join(", ")} — ${plan.changes.length} cell(s) to rewrite`);
  for (const [column, count] of Object.entries(plan.summary)) say(`  ${column}: ${count}`);

  if (!process.argv.includes("--apply")) {
    say("[media] dry run — nothing written. Re-run with --apply to rewrite (a backup file is saved).");
    return;
  }
  const backupFile = resolve(arg("--backup") ?? `backups/media-normalize-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  mkdirSync(dirname(backupFile), { recursive: true });
  const { written, skipped } = await applyMediaNormalization(prisma, plan);
  writeFileSync(backupFile, JSON.stringify({ takenAt: new Date().toISOString(), hosts: plan.hosts, changes: written }, null, 2));
  say(`[media] rewrote ${written.length} cell(s); ${skipped.length} skipped (changed since the plan). Backup: ${backupFile}`);
})()
  .catch((err) => {
    process.stderr.write(`[media] normalization failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}
`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
