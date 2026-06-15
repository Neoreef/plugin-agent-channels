#!/usr/bin/env node
/**
 * NEO-120 — shared connection-store reusability test.
 *
 * The NEO-79 suites exercise the store through Agent Channels' default keys.
 * This proves the *extracted* module is genuinely reusable: a second plugin can
 * instantiate it with its own `registryKey`/`namespace`, get the same
 * per-company isolation + legacy instance-scope fallback, and never collide with
 * Agent Channels' state. This is the contract T3 (Project Bridge) / T4
 * (Knowledge Bridge) depend on.
 *
 * Run after `npm run build`:  node scripts/test-connection-store.mjs
 */

import assert from "node:assert/strict";
import { createConnectionStore } from "../dist/lib/connections/index.js";

function makeCtx() {
  const store = new Map();
  const key = (s) => `${s.scopeKind}|${s.scopeId ?? ""}|${s.namespace ?? "default"}|${s.stateKey}`;
  return {
    _store: store,
    state: {
      async get(s) { return store.has(key(s)) ? store.get(key(s)) : null; },
      async set(s, v) { store.set(key(s), v); },
      async delete(s) { store.delete(key(s)); },
    },
  };
}

let passed = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); passed++; };

const A = "company-aaa";
const B = "company-bbb";

const projects = createConnectionStore({ registryKey: "projects.connections", namespace: "bridge.service" });
const ctx = makeCtx();

// 1. Registry isolation under a custom registryKey.
await projects.save(ctx, [{ id: "p1", type: "zoho-projects" }], A);
await projects.save(ctx, [{ id: "p2", type: "zoho-projects" }], B);
assert.deepEqual((await projects.list(ctx, A)).map((r) => r.id), ["p1"]);
assert.deepEqual((await projects.list(ctx, B)).map((r) => r.id), ["p2"]);
ok("custom registryKey: registries are isolated per company");

// 2. The custom registryKey does not collide with Agent Channels' default key.
const channels = createConnectionStore();
assert.deepEqual(await channels.list(ctx, A), []);
ok("custom registryKey does not collide with channels.services");

// 3. Auth/config/arbitrary slots are isolated per company.
await projects.setAuth(ctx, "p1", { refreshToken: "rt-A" }, A);
await projects.setAuth(ctx, "p1", { refreshToken: "rt-B" }, B);
assert.equal((await projects.getAuth(ctx, "p1", A)).refreshToken, "rt-A");
assert.equal((await projects.getAuth(ctx, "p1", B)).refreshToken, "rt-B");
await projects.setSlot(ctx, "p1", "webhook", { url: "x" }, A);
assert.equal(await projects.getSlot(ctx, "p1", "webhook", B), null);
ok("auth + arbitrary slots are isolated per company");

// 4. Legacy instance-scope fallback for a not-yet-migrated tenant.
const legacy = makeCtx();
await legacy.state.set({ scopeKind: "instance", stateKey: "projects.connections" }, [{ id: "old", type: "zoho-projects" }]);
await legacy.state.set({ scopeKind: "instance", stateKey: "bridge.service.old.auth" }, { refreshToken: "rt-old" });
assert.deepEqual((await projects.list(legacy, A)).map((r) => r.id), ["old"]);
assert.equal((await projects.getAuth(legacy, "old", A)).refreshToken, "rt-old");
ok("legacy instance-scope data still resolves through company reads");

// 5. Company-scoped writes shadow the legacy fallback.
await projects.save(legacy, [{ id: "new", type: "zoho-projects" }], A);
assert.deepEqual((await projects.list(legacy, A)).map((r) => r.id), ["new"]);
assert.deepEqual((await projects.list(legacy, B)).map((r) => r.id), ["old"]); // B still sees legacy
ok("company-scoped writes shadow the legacy fallback");

// 6. findConnected honours the predicate and scope.
const f = await projects.findConnected(ctx, "zoho-projects", (a) => Boolean(a.refreshToken), A);
assert.equal(f.id, "p1");
assert.equal(await projects.findConnected(ctx, "zoho-projects", (a) => a.refreshToken === "nope", A), null);
ok("findConnected honours predicate + company scope");

console.log(`\nNEO-120 connection-store reusability: ${passed} checks passed.`);
