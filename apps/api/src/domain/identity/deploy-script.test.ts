import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Phase 11 (BD-11.5; docker/deploy.sh): backup → verify → build → migrate → switch → readiness gate → proxy. Each step is a
// shell function; these tests replace them with stubs (DEPLOY_HOOKS) and check the order and the stops.

const SCRIPT = join(__dirname, "..", "..", "..", "..", "..", "docker", "deploy.sh");
const BASH = process.platform === "win32" && existsSync("C:\\Program Files\\Git\\bin\\bash.exe") ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const posix = (p: string) => p.replace(/\\/g, "/");

/** Phase 12 (W10): a real deploy has the store's own inputs in docker/.env; the harness passes them as environment. */
const STORE_ENV = { INSTALL_ID: "store-a", SERVER_NAME: "store.example", SERVER_ALIASES: "www.store.example", CERT_NAME: "store.example", GDRIVE_REMOTE: "gdrive:store-backups" };

function deploy(stubs: { backup?: "ok" | "fail" | "empty"; migrate?: "ok" | "fail"; ready?: "ok" | "never"; storeEnv?: Record<string, string>; pull?: "ok" | "fail"; prebuilt?: string }) {
  const dir = mkdtempSync(join(tmpdir(), "p11-deploy-"));
  const calls = posix(join(dir, "calls.log"));
  const hooks = join(dir, "hooks.sh");
  writeFileSync(
    hooks,
    [
      `do_backup() { echo backup >> "${calls}"; ${stubs.backup === "fail" ? "return 1" : stubs.backup === "empty" ? ': > "$BACKUP_FILE"' : 'printf "pg_dump output %.0s" $(seq 1 50) | gzip > "$BACKUP_FILE"'}; }`,
      // With `pull`, the real do_build runs (registry first, local build as the fallback); otherwise it is stubbed whole.
      stubs.pull
        ? `do_pull_images() { echo pull >> "${calls}"; ${stubs.pull === "fail" ? "return 1" : "true"}; }\ndo_build_local() { echo build >> "${calls}"; }`
        : `do_build() { echo build >> "${calls}"; }`,
      `do_migrate() { echo migrate >> "${calls}"; ${stubs.migrate === "fail" ? "return 1" : "true"}; }`,
      `do_switch() { echo switch >> "${calls}"; }`,
      `do_ready_probe() { echo ready >> "${calls}"; ${stubs.ready === "never" ? "return 1" : "true"}; }`,
      `do_restart_proxy() { echo proxy >> "${calls}"; }`,
    ].join("\n"),
  );
  const res = spawnSync(BASH, [posix(SCRIPT)], {
    env: { ...process.env, ENV_FILE: posix(join(dir, "missing.env")), ...(stubs.storeEnv ?? STORE_ENV), DEPLOY_HOOKS: posix(hooks), BACKUP_FILE: posix(join(dir, "backup.sql.gz")), MIN_BACKUP_BYTES: "20", READY_TIMEOUT: "2", READY_POLL: "1", DEPLOY_SHA: "test", PREBUILT_TAG: stubs.prebuilt ?? "" },
    encoding: "utf8",
    timeout: 30_000,
  });
  const log = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : [];
  return { code: res.status, out: `${res.stdout}\n${res.stderr}`, calls: log };
}

describe("deploy script (brief downtime, no blue/green)", () => {
  it("a successful run follows backup → build → migrate → switch → readiness → proxy", () => {
    const r = deploy({});
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(["backup", "build", "migrate", "switch", "ready", "proxy"]);
    expect(r.out).toContain("DEPLOY OK");
  });

  it("Phase 1: a missing INSTALL_ID stops at the preflight too", () => {
    const r = deploy({ storeEnv: { ...STORE_ENV, INSTALL_ID: "" } });
    expect(r.code).not.toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.out).toMatch(/DEPLOY FAILED: missing per-store configuration in .*: INSTALL_ID .*nothing was changed/);
  });

  it("Phase 12: missing per-store configuration stops at the preflight, before the backup or anything else", () => {
    const { SERVER_NAME: _drop, GDRIVE_REMOTE: _drop2, ...partial } = STORE_ENV;
    const r = deploy({ storeEnv: { ...partial, SERVER_NAME: "", GDRIVE_REMOTE: "" } });
    expect(r.code).toBe(1);
    expect(r.calls).toEqual([]);
    expect(r.out).toMatch(/DEPLOY FAILED: missing per-store configuration in .*: SERVER_NAME GDRIVE_REMOTE .*nothing was changed/);
  });

  it("a failed or empty backup stops before anything changes", () => {
    for (const backup of ["fail", "empty"] as const) {
      const r = deploy({ backup });
      expect(r.code).toBe(1);
      expect(r.calls).toEqual(["backup"]);
      expect(r.out).toContain("DEPLOY FAILED");
    }
  });

  it("a failed migration stops before the new code is started", () => {
    const r = deploy({ migrate: "fail" });
    expect(r.code).toBe(1);
    expect(r.calls).toEqual(["backup", "build", "migrate"]);
    expect(r.out).toMatch(/migration failed/);
  });

  it("readiness that never turns healthy fails the deploy after the timeout (with rollback instructions)", () => {
    const r = deploy({ ready: "never" });
    expect(r.code).toBe(1);
    expect(r.calls.slice(0, 4)).toEqual(["backup", "build", "migrate", "switch"]);
    expect(r.calls.filter((c) => c === "ready").length).toBeGreaterThanOrEqual(2);
    expect(r.calls).not.toContain("proxy");
    expect(r.out).toMatch(/readiness did not become healthy/);
    expect(r.out).toMatch(/Rollback/);
  });
});

describe("ready-made images from CI (PREBUILT_TAG)", () => {
  it("downloads the images CI built instead of building on the server", () => {
    const r = deploy({ pull: "ok", prebuilt: "abc123" });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(["backup", "pull", "migrate", "switch", "ready", "proxy"]);
    expect(r.out).toContain("using the images CI built for abc123");
  });

  it("falls back to building on the server when the download fails, and the deploy still goes through", () => {
    const r = deploy({ pull: "fail", prebuilt: "abc123" });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(["backup", "pull", "build", "migrate", "switch", "ready", "proxy"]);
    expect(r.out).toContain("building on this server instead");
  });

  it("without a tag it builds on the server as before and never touches the registry", () => {
    const r = deploy({ pull: "ok" });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual(["backup", "build", "migrate", "switch", "ready", "proxy"]);
  });
});

describe("the name a downloaded image is given", () => {
  /** Runs deploy.sh's compose_image_name against a fake `compose config --images` that prints `lines`. */
  function imageName(svc: string, lines: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "p11-images-"));
    const fake = posix(join(dir, "compose.sh"));
    writeFileSync(fake, `printf '%s\n' ${lines.map((l) => `'${l}'`).join(" ")}\n`);
    const hooks = join(dir, "hooks.sh");
    writeFileSync(hooks, `if n="$(compose_image_name ${svc})"; then echo "NAME=$n"; else echo "NONE"; fi; exit 0\n`);
    const res = spawnSync(BASH, [posix(SCRIPT)], { env: { ...process.env, COMPOSE: `bash ${fake}`, DEPLOY_HOOKS: posix(hooks), ENV_FILE: posix(join(dir, "missing.env")) }, encoding: "utf8", timeout: 30_000 });
    return res.stdout.trim();
  }
  const real = ["postgres:16-alpine", "redis:7-alpine", "asifzone-api", "asifzone-web", "nginx:1.27-alpine", "certbot/certbot:latest"];

  it("is the service's own built-image name, never one of its dependencies", () => {
    expect(imageName("api", real)).toBe("NAME=asifzone-api");
    expect(imageName("web", real)).toBe("NAME=asifzone-web");
  });

  it("refuses when the name is missing or not unique (the deploy then builds on the server)", () => {
    expect(imageName("api", ["postgres:16-alpine", "redis:7-alpine"])).toBe("NONE");
    expect(imageName("api", ["asifzone-api", "other-api"])).toBe("NONE");
    expect(imageName("api", ["ghcr.io/x/asifzone-api:1"])).toBe("NONE");
  });
});
