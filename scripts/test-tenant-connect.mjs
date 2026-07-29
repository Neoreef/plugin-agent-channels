#!/usr/bin/env node
/**
 * PRE-790 / PRE-329 T2 — tenant-facing connect surface verification.
 *
 * Proves the "Done when" of the issue against the compiled build:
 *   - A tenant with ONLY their companyId (no operator UI, no operator creds)
 *     gets a working Zoho authorize URL from the shared app-level client.
 *   - The OAuth `state` namespaces the flow per company and carries a single-use
 *     CSRF nonce.
 *   - Simulating the existing oauth-callback return path lands the token in the
 *     COMPANY-SCOPED store — and only that company's store (no cross-tenant leak).
 *   - The CSRF nonce is single-use (replay rejected) and company-isolated.
 *
 * Run after `npm run build`:  node scripts/test-tenant-connect.mjs
 */

import assert from "node:assert/strict";
import {
  buildTenantConnectUrl,
  consumeNonce,
  getTenantConnectConfig,
  saveTenantConnectConfig,
  ensureTenantService,
  resolveAppOAuthClient,
} from "../dist/lib/tenant-connect.js";
import { serviceStore } from "../dist/lib/service-store.js";

// ── Fake PluginContext: company/instance-scoped state + operator instance config
function makeCtx(config = {}) {
  const store = new Map();
  const key = (s) => `${s.scopeKind}|${s.scopeId ?? ""}|${s.stateKey}`;
  return {
    _store: store,
    config: { async get() { return config; } },
    logger: { info() {}, error() {}, warn() {} },
    state: {
      async get(s) { return store.has(key(s)) ? store.get(key(s)) : null; },
      async set(s, v) { store.set(key(s), v); },
      async delete(s) { store.delete(key(s)); },
    },
  };
}

const APP_CONFIG = {
  zohoClientId: "1000.APPCLIENTID",
  zohoClientSecret: "app-secret-xyz",
  oauthCallbackUrl: "https://cortex.example.com/paperclip/api/plugins/agent-channels/routes/callback",
};
const PLUGIN_ID = "agent-channels";
const A = "company-aaa";
const B = "company-bbb";

let passed = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); passed++; };
const parseState = (url) => JSON.parse(decodeURIComponent(new URL(url).searchParams.get("state")));

// 1. No operator app config → not configured (clear tenant-facing reason, no throw).
{
  const ctx = makeCtx({});
  const r = await buildTenantConnectUrl(ctx, { companyId: A, pluginId: PLUGIN_ID });
  assert.equal(r.configured, false);
  assert.match(r.reason, /OAuth app setup|administrator/i);
  ok("no app OAuth config → configured:false with a tenant-facing reason (no throw)");
}

// 2. Tenant with only companyId builds a valid authorize URL from the APP client.
let stateA;
{
  const ctx = makeCtx(APP_CONFIG);
  const client = await resolveAppOAuthClient(ctx);
  assert.equal(client.clientId, APP_CONFIG.zohoClientId);

  const r = await buildTenantConnectUrl(ctx, { companyId: A, pluginId: PLUGIN_ID });
  assert.equal(r.configured, true);
  const u = new URL(r.connectUrl);
  assert.equal(u.host, "accounts.zoho.com");
  assert.equal(u.searchParams.get("client_id"), APP_CONFIG.zohoClientId);
  assert.equal(u.searchParams.get("redirect_uri"), APP_CONFIG.oauthCallbackUrl);
  // The client SECRET must never appear on the tenant authorize URL.
  assert.ok(!r.connectUrl.includes(APP_CONFIG.zohoClientSecret), "secret leaked into authorize URL");

  stateA = parseState(r.connectUrl);
  assert.equal(stateA.companyId, A);
  assert.equal(stateA.src, "tenant");
  assert.ok(stateA.nonce, "tenant flow carries a CSRF nonce");
  assert.equal(stateA.serviceId, r.serviceId);
  ok("tenant (companyId only) → valid authorize URL from app client, secret never exposed, state namespaced + nonce");
}

// 3. The provisioned service is company-scoped and idempotent (no dup on revisit).
{
  const ctx = makeCtx(APP_CONFIG);
  const r1 = await buildTenantConnectUrl(ctx, { companyId: A, pluginId: PLUGIN_ID });
  const r2 = await buildTenantConnectUrl(ctx, { companyId: A, pluginId: PLUGIN_ID });
  assert.equal(r1.serviceId, r2.serviceId, "revisiting the link reuses the same company service");
  const svcsA = await serviceStore.list(ctx, A);
  const svcsB = await serviceStore.list(ctx, B);
  assert.equal(svcsA.length, 1);
  assert.equal(svcsB.length, 0, "company A's service must not appear under company B");
  ok("company-scoped service provisioning is idempotent + isolated per company");
}

// 4. Full round-trip: connect → simulate oauth-callback token exchange → token
//    lands in the COMPANY-scoped store, and only that company's store.
{
  const ctx = makeCtx(APP_CONFIG);
  const r = await buildTenantConnectUrl(ctx, { companyId: A, pluginId: PLUGIN_ID });
  const st = parseState(r.connectUrl);

  // CSRF gate the real callback runs first.
  assert.equal(await consumeNonce(ctx, st.companyId, st.serviceId, st.nonce), true);

  // Emulate the token the callback would persist (handleOAuthCallback →
  // serviceStore.setAuth(serviceId, auth, companyId)).
  await serviceStore.setAuth(ctx, st.serviceId, {
    refreshToken: "rt-A", accessToken: "at-A", expiresAt: Date.now() + 3600_000, dataCenter: "US",
  }, A);

  const inA = await serviceStore.getAuth(ctx, st.serviceId, A);
  const inB = await serviceStore.getAuth(ctx, st.serviceId, B);
  assert.equal(inA.refreshToken, "rt-A");
  assert.equal(inB, null, "token must not be readable under another company");
  ok("round-trip: token lands in company-scoped store, invisible to other companies");
}

// 5. CSRF nonce is single-use (replay rejected) and company-isolated.
{
  const ctx = makeCtx(APP_CONFIG);
  const r = await buildTenantConnectUrl(ctx, { companyId: A, pluginId: PLUGIN_ID });
  const st = parseState(r.connectUrl);
  assert.equal(await consumeNonce(ctx, A, st.serviceId, st.nonce), true, "first use accepted");
  assert.equal(await consumeNonce(ctx, A, st.serviceId, st.nonce), false, "replay rejected (single use)");

  const r2 = await buildTenantConnectUrl(ctx, { companyId: A, pluginId: PLUGIN_ID });
  const st2 = parseState(r2.connectUrl);
  assert.equal(await consumeNonce(ctx, B, st2.serviceId, st2.nonce), false, "nonce not valid under a different company");
  assert.equal(await consumeNonce(ctx, A, "wrong-service", st2.nonce), false, "nonce bound to its serviceId");
  ok("CSRF nonce: single-use, company-scoped, serviceId-bound");
}

// 6. Per-company non-OAuth config persists under company scope + drives the URL.
{
  const ctx = makeCtx(APP_CONFIG);
  await saveTenantConnectConfig(ctx, A, { dataCenter: "EU" });
  const cfgA = await getTenantConnectConfig(ctx, A);
  const cfgB = await getTenantConnectConfig(ctx, B);
  assert.equal(cfgA.dataCenter, "EU");
  assert.equal(cfgB.dataCenter, "US", "config change for A must not affect B");

  const r = await buildTenantConnectUrl(ctx, { companyId: A, pluginId: PLUGIN_ID });
  assert.equal(new URL(r.connectUrl).host, "accounts.zoho.eu", "EU data center drives the authorize host");
  ok("per-company non-OAuth config persists under company scope + is isolated + drives the authorize URL");
}

// 7. A disabled channel is rejected (defense in depth).
{
  const ctx = makeCtx(APP_CONFIG);
  await saveTenantConnectConfig(ctx, A, { enabledChannels: ["zoho-cliq"] });
  const r = await buildTenantConnectUrl(ctx, { companyId: A, channelType: "zoho-mail", pluginId: PLUGIN_ID });
  assert.equal(r.configured, false);
  assert.match(r.reason, /not enabled/i);
  ok("requesting a channel that is not enabled for the company is rejected");
}

console.log(`\n${passed} checks passed — PRE-790 tenant connect surface verified.`);
