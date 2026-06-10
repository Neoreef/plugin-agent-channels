#!/usr/bin/env node
/**
 * NEO-79 — per-company token storage isolation test.
 *
 * Exercises the compiled service-store against a mock state backend that mimics
 * the host's `(scopeKind, scopeId, stateKey)` composite key. Proves two
 * companies' service lists, auth, and config never collide, and that the legacy
 * instance-scope fallback still serves a not-yet-migrated tenant.
 *
 * Run after `npm run build`:  node scripts/test-per-company.mjs
 */

import assert from "node:assert/strict";
import {
  listServices,
  saveServices,
  getServiceAuth,
  saveServiceAuth,
  deleteServiceAuth,
  getServiceOAuthConfig,
  saveServiceOAuthConfig,
  getServiceType,
  findConnectedService,
} from "../dist/lib/service-store.js";

// ─── Mock ctx.state: a Map keyed by the host's composite scope key ───────────
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

const A = "company-aaa";
const B = "company-bbb";
const auth = (tok) => ({ refreshToken: tok, accessToken: `at-${tok}`, expiresAt: Date.now() + 3_600_000, dataCenter: "US" });

let passed = 0;
const ok = (msg) => { passed++; console.log(`  ✓ ${msg}`); };

async function main() {
  const ctx = makeCtx();

  // 1. Each company owns an independent service list.
  await saveServices(ctx, [{ id: "zoho-cliq-1", type: "zoho-cliq", name: "A Cliq" }], A);
  await saveServices(ctx, [{ id: "zoho-cliq-2", type: "zoho-cliq", name: "B Cliq" }], B);
  assert.deepEqual((await listServices(ctx, A)).map((s) => s.id), ["zoho-cliq-1"]);
  assert.deepEqual((await listServices(ctx, B)).map((s) => s.id), ["zoho-cliq-2"]);
  ok("service lists are isolated per company");

  // 2. Auth is namespaced per company — same serviceId, different tokens.
  await saveServiceAuth(ctx, "zoho-cliq-1", auth("refresh-A"), A);
  await saveServiceAuth(ctx, "zoho-cliq-2", auth("refresh-B"), B);
  assert.equal((await getServiceAuth(ctx, "zoho-cliq-1", A)).refreshToken, "refresh-A");
  assert.equal((await getServiceAuth(ctx, "zoho-cliq-2", B)).refreshToken, "refresh-B");
  ok("auth tokens are isolated per company");

  // 3. Company B cannot read company A's service auth (no cross-tenant leak).
  assert.equal(await getServiceAuth(ctx, "zoho-cliq-1", B), null);
  ok("company B cannot read company A's token");

  // 4. OAuth config is namespaced per company.
  await saveServiceOAuthConfig(ctx, "zoho-cliq-1", { clientId: "cid-A", clientSecret: "sec-A", callbackUrl: "u", dataCenter: "US" }, A);
  assert.equal((await getServiceOAuthConfig(ctx, "zoho-cliq-1", A)).clientId, "cid-A");
  assert.equal(await getServiceOAuthConfig(ctx, "zoho-cliq-1", B), null);
  ok("OAuth config is isolated per company");

  // 5. findConnectedService resolves the company's own service only.
  const fa = await findConnectedService(ctx, "zoho-cliq", A);
  const fb = await findConnectedService(ctx, "zoho-cliq", B);
  assert.equal(fa.serviceId, "zoho-cliq-1");
  assert.equal(fb.serviceId, "zoho-cliq-2");
  assert.equal(fa.auth.refreshToken, "refresh-A");
  ok("findConnectedService resolves per-company service");

  // 6. getServiceType reads the company-scoped registry.
  assert.equal(await getServiceType(ctx, "zoho-cliq-1", A), "zoho-cliq");
  ok("getServiceType resolves per-company");

  // 7. Disconnect removes only that company's auth.
  await deleteServiceAuth(ctx, "zoho-cliq-1", A);
  assert.equal(await getServiceAuth(ctx, "zoho-cliq-1", A), null);
  assert.equal((await getServiceAuth(ctx, "zoho-cliq-2", B)).refreshToken, "refresh-B");
  ok("disconnect is scoped to one company");

  // 8. Legacy fallback: instance-scoped data serves a not-yet-migrated tenant.
  const legacy = makeCtx();
  await saveServices(legacy, [{ id: "zoho-cliq-legacy", type: "zoho-cliq", name: "Legacy" }]); // no companyId → instance
  await saveServiceAuth(legacy, "zoho-cliq-legacy", auth("refresh-legacy"));                   // instance
  // A company with no company-scoped data of its own falls back to the legacy global.
  assert.deepEqual((await listServices(legacy, "some-company")).map((s) => s.id), ["zoho-cliq-legacy"]);
  assert.equal((await getServiceAuth(legacy, "zoho-cliq-legacy", "some-company")).refreshToken, "refresh-legacy");
  ok("legacy instance-scope data still resolves (migration bridge)");

  // 9. Once a company writes its own list, it no longer sees legacy data.
  await saveServices(legacy, [{ id: "zoho-cliq-own", type: "zoho-cliq", name: "Own" }], "some-company");
  assert.deepEqual((await listServices(legacy, "some-company")).map((s) => s.id), ["zoho-cliq-own"]);
  ok("company-scoped writes shadow the legacy fallback");

  console.log(`\nNEO-79 per-company isolation: ${passed} checks passed.`);
}

main().catch((err) => { console.error("\n✗ TEST FAILED:", err.message); process.exit(1); });
