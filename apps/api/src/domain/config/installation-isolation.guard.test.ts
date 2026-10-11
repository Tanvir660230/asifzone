import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { namespace } from "../../config/installation";
import { createObservedWorker } from "../../lib/observability/jobs";
import { queueConnection } from "../../lib/queue";

// Phase 1 installation-isolation guards (docs/STORE_DEPLOYMENT.md "Installation identity", docs/BUSINESS_DECISIONS.md D17–D21).
// Several installations may share one Redis server; they stay apart only because every key, lock and queue is named
// through the installation namespace (config/installation.ts). These guards read the module graph and syntax tree — not
// text patterns — so a new Redis connection, a queue opened outside the factory, or a raw key that skips the namespace
// fails here instead of silently mixing two stores' data.

const SRC = join(__dirname, "..", "..");
const rel = (f: string) => relative(SRC, f).replace(/\\/g, "/");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") && !full.endsWith(".d.ts") ? [full] : [];
  });
}

const SOURCES = files(SRC).map((f) => ({ file: rel(f), sf: ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true) }));

/** Value (non-type) names a module imports from `specifier` — `import type` and `type X` specifiers excluded. */
function valueImports(sf: ts.SourceFile, matches: (specifier: string) => boolean): string[] {
  const names: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || !matches(stmt.moduleSpecifier.text)) continue;
    const clause = stmt.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) names.push("default");
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
    if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
  }
  return names;
}

const importers = (matches: (s: string) => boolean, names?: string[]) =>
  SOURCES.filter(({ sf }) => valueImports(sf, matches).some((n) => !names || names.includes(n) || n === "*")).map((s) => s.file).sort();

const isModule = (suffix: string) => (s: string) => s === suffix || s.endsWith(`/${suffix}`);

function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node);
  node.forEachChild((c) => walk(c, visit));
}

/** True when the expression is (or contains) a call through the installation namespace, e.g. `namespace.lock(...)`. */
function usesNamespace(expr: ts.Node): boolean {
  let found = false;
  walk(expr, (n) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "namespace") found = true;
  });
  return found;
}

/** Follows an identifier to its `const`/`let` initializer(s) in the same file. */
function initializersOf(sf: ts.SourceFile, name: string): ts.Expression[] {
  const found: ts.Expression[] = [];
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) found.push(n.initializer);
  });
  return found;
}

/** Redis commands whose first argument is a key. */
const KEY_COMMANDS = new Set(["get", "set", "setex", "setnx", "getset", "getdel", "del", "unlink", "exists", "expire", "pexpire", "ttl", "pttl", "incr", "incrby", "decr", "decrby", "hget", "hset", "hdel", "hgetall", "hincrby", "sadd", "srem", "smembers", "sismember", "zadd", "zrem", "zrange", "zincrby", "lpush", "rpush", "lrange", "ltrim", "mget", "mset", "keys", "watch"]);

describe("installation isolation — architecture guards", () => {
  it("opens Redis connections in exactly two places: the cache/lock client and the BullMQ connection", () => {
    expect(importers((s) => s === "ioredis")).toEqual(["config/redis.ts", "lib/queue.ts"]);
  });

  it("constructs BullMQ queues and workers only through the installation-prefixed factories", () => {
    // createQueue (lib/queue.ts) and createObservedWorker (lib/observability/jobs.ts) both apply namespace.queuePrefix.
    expect(importers((s) => s === "bullmq", ["Queue", "Worker", "QueueEvents", "FlowProducer", "Job"])).toEqual(["lib/observability/jobs.ts", "lib/queue.ts"]);
  });

  it("uses the raw Redis client only in the modules that hold distributed locks (plus startup)", () => {
    expect(importers(isModule("config/redis"), ["redis"])).toEqual(["modules/orders/order.service.ts", "modules/payments/payment.service.ts", "server.ts"]);
  });

  it("names every key a raw Redis command touches through the installation namespace", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const { file, sf } of SOURCES) {
      if (file === "config/redis.ts") continue; // the cache helpers themselves — covered by config/installation.test.ts against Redis
      walk(sf, (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
        const target = n.expression.expression;
        const command = n.expression.name.text.toLowerCase();
        if (!ts.isIdentifier(target) || !["redis", "queueConnection"].includes(target.text) || !KEY_COMMANDS.has(command)) return;
        const key = n.arguments[0];
        checked++;
        const derived =
          key !== undefined &&
          (usesNamespace(key) || (ts.isIdentifier(key) && initializersOf(sf, key.text).length > 0 && initializersOf(sf, key.text).every(usesNamespace)));
        if (!derived) offenders.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${target.text}.${command}(${key?.getText() ?? ""})`);
      });
    }
    expect(offenders).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(5); // the order-create, payment-retry and payment-init locks (set + del)
  });

  it("gives every BullMQ worker this installation's prefix", async () => {
    const worker = createObservedWorker("guard-probe", async () => undefined, { connection: queueConnection, autorun: false });
    try {
      expect(worker.opts.prefix).toBe(namespace.queuePrefix);
    } finally {
      await worker.close();
    }
  });
});
