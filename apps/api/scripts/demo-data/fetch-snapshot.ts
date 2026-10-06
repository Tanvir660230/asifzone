/**
 * Step 1 of the demo-data mirror (docs/DEMO_DATA.md §3): take a READ-ONLY snapshot of the production database (and its
 * uploaded images) over SSH, into SNAPSHOT_DIR on this machine. Nothing in production is written:
 *
 *   - the database is read by `pg_dump` (a single REPEATABLE READ, READ ONLY transaction by design) in a session started
 *     with PGOPTIONS='-c default_transaction_read_only=on', so the server itself rejects any write that session could
 *     attempt — no role, setting, or schema is created or changed on the server;
 *   - images are read by `tar czf -` of the uploads volume, streamed to stdout;
 *   - output is streamed back over the SSH channel; no file is left on the VPS.
 *
 *   pnpm --filter api demo:fetch              # database + images
 *   pnpm --filter api demo:fetch --no-media   # database only
 *
 * Source settings (env, all optional): DEMO_SOURCE_SSH, DEMO_SOURCE_SSH_KEY, DEMO_SOURCE_COMPOSE_DIR, DEMO_SOURCE_DATABASE.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SNAPSHOT_DIR, SOURCE, fail, isPgDumpArchive } from "./lib";

const withMedia = !process.argv.includes("--no-media");

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Runs `remoteCommand` on the source host and streams its stdout into `file` (written to a .part first). */
function streamFromSource(remoteCommand: string, file: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const part = `${file}.part`;
    const out = createWriteStream(part);
    const child = spawn(
      "ssh",
      ["-i", SOURCE.sshKey, "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", SOURCE.ssh, remoteCommand],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.stdout.pipe(out);
    child.on("error", reject);
    child.on("close", (code) => {
      out.end(() => {
        if (code !== 0) {
          if (existsSync(part)) unlinkSync(part);
          reject(new Error(`remote command exited ${code}: ${stderr.trim()}`));
          return;
        }
        renameSync(part, file);
        resolvePromise();
      });
    });
  });
}

(async () => {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const dumpFile = join(SNAPSHOT_DIR, `asifzone-${stamp}.dump`);
  const mediaFile = join(SNAPSHOT_DIR, `asifzone-${stamp}.uploads.tar.gz`);
  const compose = `cd ${shellQuote(SOURCE.composeDir)} && docker compose`;

  console.log(`[demo-data] source: ${SOURCE.ssh}:${SOURCE.composeDir} database "${SOURCE.database}" (read-only)`);
  console.log(`[demo-data] snapshot dir: ${SNAPSHOT_DIR}`);

  console.log("[demo-data] dumping database (pg_dump, read-only session)...");
  await streamFromSource(
    `${compose} exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres ` +
      `pg_dump -U postgres --format=custom --no-owner --no-privileges ${shellQuote(SOURCE.database)}`,
    dumpFile,
  );
  if (!isPgDumpArchive(dumpFile)) fail(`${dumpFile} is not a pg_dump archive`);
  console.log(`[demo-data]   ${dumpFile} (${(statSync(dumpFile).size / 1024 / 1024).toFixed(1)} MB)`);

  if (withMedia) {
    console.log("[demo-data] archiving uploaded images (tar, read-only)...");
    await streamFromSource(`${compose} exec -T api tar czf - -C /repo/apps/api/uploads .`, mediaFile);
    console.log(`[demo-data]   ${mediaFile} (${(statSync(mediaFile).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  writeFileSync(
    join(SNAPSHOT_DIR, `asifzone-${stamp}.json`),
    JSON.stringify({ takenAt: new Date().toISOString(), source: { ...SOURCE, sshKey: undefined }, dumpFile, mediaFile: withMedia ? mediaFile : null }, null, 2),
  );
  console.log("\n[demo-data] snapshot complete. Next: pnpm --filter api demo:import");
})().catch((err) => fail(err instanceof Error ? err.message : String(err)));
