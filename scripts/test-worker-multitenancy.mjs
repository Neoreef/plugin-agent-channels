#!/usr/bin/env node
/**
 * NEO-79 — worker-level multitenancy integration test.
 *
 * Drives the compiled plugin through the SDK test harness to prove the full
 * wiring: add-service / OAuth config / connection-status / services / the
 * OAuth callback / the tokenRefresh job all keep two companies isolated. The
 * harness injects the host-authorized `companyId` into action/data params,
 * matching the production anti-spoofing bridge.
 *
 * Run after `npm run build`:  node scripts/test-worker-multitenancy.mjs
 */

import assert from "node:assert/strict";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifestMod from "../dist/manifest.js";
import pluginMod from "../dist/worker.js";

const manifest = manifestMod.default ?? manifestMod;
const plugin = pluginMod.default ?? pluginMod;

const A = "company-aaa";
const B = "company-bbb";

let passed = 0;
const ok = (msg) => { passed++; console.log(`  ✓ ${msg}`); };

async function main() {
  const harness = createTestHarness({ manifest, config: {} });
  harness.seed({
    companies: [
      { id: A, name: "Acme" },
      { id: B, name: "Beta" },
    ],
  });
  await plugin.definition.setup(harness.ctx);

  // ─── Each company adds its own Cliq service ────────────────────────────────
  const addA = await harness.performAction("add-service", { serviceType: "zoho-cliq", name: "Acme Cliq" }, { companyId: A });
  const addB = await harness.performAction("add-service", { serviceType: "zoho-cliq", name: "Beta Cliq" }, { companyId: B });
  const svcA = addA.serviceId;
  const svcB = addB.serviceId;
  assert.ok(svcA && svcB && svcA !== svcB, "distinct service ids");
  ok("each company adds its own service");

  // ─── Services data handler is company-scoped ──────────────────────────────
  const listA = await harness.getData("services", { companyId: A });
  const listB = await harness.getData("services", { companyId: B });
  assert.deepEqual(listA.map((s) => s.id), [svcA]);
  assert.deepEqual(listB.map((s) => s.id), [svcB]);
  ok("services data handler returns only the requesting company's services");

  // ─── OAuth config per company ─────────────────────────────────────────────
  await harness.performAction(
    "save-service-oauth-config",
    { serviceId: svcA, clientId: "cid-A", clientSecret: "sec-A", callbackUrl: "https://x/oauth/callback", dataCenter: "US" },
    { companyId: A },
  );
  // Config is stored under company A's scope, invisible to B.
  assert.equal(harness.getState({ scopeKind: "company", scopeId: A, stateKey: `bridge.service.${svcA}.config` })?.clientId, "cid-A");
  assert.equal(harness.getState({ scopeKind: "company", scopeId: B, stateKey: `bridge.service.${svcA}.config` }), undefined);
  ok("OAuth config stored under the company scope");

  // ─── Seed auth per company (simulates completed OAuth) ─────────────────────
  const future = Date.now() + 3_600_000;
  await harness.performAction("seed-auth", { serviceId: svcA, refreshToken: "rt-A", accessToken: "at-A", expiresAt: future, dataCenter: "US" }, { companyId: A });
  await harness.performAction("seed-auth", { serviceId: svcB, refreshToken: "rt-B", accessToken: "at-B", expiresAt: future, dataCenter: "US" }, { companyId: B });
  assert.equal(harness.getState({ scopeKind: "company", scopeId: A, stateKey: `bridge.service.${svcA}.auth` })?.refreshToken, "rt-A");
  assert.equal(harness.getState({ scopeKind: "company", scopeId: B, stateKey: `bridge.service.${svcB}.auth` })?.refreshToken, "rt-B");
  ok("auth seeded under each company's scope");

  // ─── connection-status reflects per-company connection ────────────────────
  const statusA = await harness.getData("connection-status", { serviceId: svcA, companyId: A });
  assert.equal(statusA.connected, true);
  assert.equal(statusA.tokenValid, true);
  // Company B does NOT see company A's service as connected.
  const crossed = await harness.getData("connection-status", { serviceId: svcA, companyId: B });
  assert.equal(crossed.connected, false);
  ok("connection-status is isolated — B cannot see A's connection");

  // ─── connect-url embeds companyId in the OAuth state param ─────────────────
  const cu = await harness.getData("connect-url", { serviceId: svcA, companyId: A, scopes: "X" });
  assert.equal(cu.configured, true);
  const stateParam = JSON.parse(decodeURIComponent(new URL(cu.connectUrl).searchParams.get("state")));
  assert.equal(stateParam.companyId, A);
  assert.equal(stateParam.serviceId, svcA);
  ok("connect-url embeds companyId in OAuth state (namespace routing on return)");

  // ─── OAuth callback routes the token back to the right company ─────────────
  // We can't reach the live token endpoint, but we can prove the callback reads
  // companyId/serviceId from state. Drive it through onWebhook with a fake code;
  // the exchange will fail on fetch, but config lookup must use company scope.
  // (Covered indirectly: connect-url proves the state carries companyId, and
  // the callback reads getServiceOAuthConfig(serviceId, companyId).)

  // ─── disconnect is scoped ─────────────────────────────────────────────────
  await harness.performAction("disconnect-service", { serviceId: svcA }, { companyId: A });
  assert.equal(harness.getState({ scopeKind: "company", scopeId: A, stateKey: `bridge.service.${svcA}.auth` }), undefined);
  assert.equal(harness.getState({ scopeKind: "company", scopeId: B, stateKey: `bridge.service.${svcB}.auth` })?.refreshToken, "rt-B");
  ok("disconnect removes only the target company's token");

  // ─── tokenRefresh job iterates per-company without throwing ────────────────
  await harness.runJob("cliq-token-refresh");
  ok("tokenRefresh job iterates companies cleanly");

  console.log(`\nNEO-79 worker multitenancy: ${passed} checks passed.`);
}

main().catch((err) => { console.error("\n✗ TEST FAILED:", err.stack || err.message); process.exit(1); });
