import assert from "node:assert/strict";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifestMod from "../dist/manifest.js";
import pluginMod from "../dist/worker.js";
import { getServiceAuth } from "../dist/lib/service-store.js";

const manifest = manifestMod.default ?? manifestMod;
const plugin = pluginMod.default ?? pluginMod;

async function main() {
  const harness = createTestHarness({ manifest, config: { zohoClientId: "cid", zohoClientSecret: "sec" } });
  await plugin.definition.setup(harness.ctx);

  // We need to mock ctx.http.fetch to intercept the OAuth refresh call
  const originalFetch = harness.ctx.http.fetch;
  let fetchCallCount = 0;
  harness.ctx.http.fetch = async (url, opts) => {
    if (url.includes("/oauth/v2/token")) {
      fetchCallCount++;
      return {
        ok: true,
        json: async () => ({ access_token: `new_access_token_${fetchCallCount}`, expires_in: 3600 })
      };
    }
    return originalFetch(url, opts);
  };

  const serviceId = "cliq-service-123";
  const auth = {
    accessToken: "old_access_token",
    refreshToken: "refresh_123",
    dataCenter: "US",
    expiresAt: Date.now() - 1000, // already expired
  };

  // Seed instance-scoped
  await harness.ctx.state.set({ scopeKind: "instance", stateKey: `bridge.service.${serviceId}.auth` }, auth);

  // Perform refresh (via getAccessToken which resolveAuth uses)
  const worker = await import("../dist/worker.js");
  const { proactiveServiceTokenRefresh } = await import("../dist/lib/cliq-client.js");
  
  await proactiveServiceTokenRefresh(harness.ctx, serviceId);
  
  assert.equal(fetchCallCount, 1, "Should have fetched new token");
  
  const updated = await harness.ctx.state.get({ scopeKind: "instance", stateKey: `bridge.service.${serviceId}.auth` });
  assert.equal(updated.accessToken, "new_access_token_1", "Access token should be updated");
  assert.equal(updated.refreshToken, "refresh_123", "Refresh token should remain");
  assert.ok(updated.expiresAt > Date.now() + 1000, "Should have future expiry");
  
  // Try another refresh, shouldn't fetch because it's not expired
  await proactiveServiceTokenRefresh(harness.ctx, serviceId);
  assert.equal(fetchCallCount, 1, "Should NOT fetch new token if not expired");
  
  // Force expire again
  updated.expiresAt = Date.now() - 1000;
  await harness.ctx.state.set({ scopeKind: "instance", stateKey: `bridge.service.${serviceId}.auth` }, updated);
  
  await proactiveServiceTokenRefresh(harness.ctx, serviceId);
  assert.equal(fetchCallCount, 2, "Should fetch new token on second expiry");
  
  const updated2 = await harness.ctx.state.get({ scopeKind: "instance", stateKey: `bridge.service.${serviceId}.auth` });
  assert.equal(updated2.accessToken, "new_access_token_2", "Access token should be updated again");
  
  console.log("Token refresh verification passed.");
}

main().catch((err) => { console.error("FAILED:", err); process.exit(1); });
