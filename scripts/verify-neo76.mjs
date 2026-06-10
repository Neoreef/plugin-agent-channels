// NEO-76 verification: per-service token-refresh dedup against the REAL compiled
// cliq-client.js. Drives proactiveServiceTokenRefresh concurrently and counts
// how many times the Zoho /oauth/v2/token endpoint is actually hit.
import { proactiveServiceTokenRefresh } from "../dist/lib/cliq-client.js";

let tokenHits = {}; // serviceId-ish bucket -> count, keyed by refresh_token

function makeCtx() {
  // In-memory instance state, seeded with two connected services whose tokens
  // are already expired (expiresAt in the past) so a refresh is forced.
  const store = new Map();
  const past = Date.now() - 60_000;
  store.set("bridge.service.A.auth", { refreshToken: "rt-A", accessToken: "old-A", expiresAt: past, dataCenter: "US" });
  store.set("bridge.service.B.auth", { refreshToken: "rt-B", accessToken: "old-B", expiresAt: past, dataCenter: "US" });
  store.set("bridge.service.A.config", { clientId: "cid-A", clientSecret: "sec-A", dataCenter: "US" });
  store.set("bridge.service.B.config", { clientId: "cid-B", clientSecret: "sec-B", dataCenter: "US" });
  store.set("channels.services", [{ id: "A", type: "zoho-cliq" }, { id: "B", type: "zoho-cliq" }]);

  return {
    state: {
      async get({ stateKey }) { return store.has(stateKey) ? store.get(stateKey) : null; },
      async set({ stateKey }, v) { store.set(stateKey, v); },
    },
    config: { async get() { return {}; } },
    logger: { info() {}, error() {} },
    http: {
      async fetch(url, init) {
        // Identify which service by the refresh_token in the body.
        const body = String(init?.body ?? "");
        const rt = /refresh_token=([^&]+)/.exec(body)?.[1] ?? "?";
        tokenHits[rt] = (tokenHits[rt] ?? 0) + 1;
        // Simulate network latency so concurrent calls genuinely overlap.
        await new Promise((r) => setTimeout(r, 50));
        return {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "application/json"]]),
          async text() { return JSON.stringify({ access_token: `new-${rt}`, expires_in: 3600 }); },
          async json() { return { access_token: `new-${rt}`, expires_in: 3600 }; },
        };
      },
    },
  };
}

async function run() {
  // Test 1: 8 concurrent refreshes for the SAME service => exactly 1 token hit.
  tokenHits = {};
  let ctx = makeCtx();
  await Promise.all(Array.from({ length: 8 }, () => proactiveServiceTokenRefresh(ctx, "A")));
  const sameService = tokenHits["rt-A"] ?? 0;

  // Test 2: concurrent refreshes for TWO services => each hits exactly once,
  // independently (no cross-service clobber).
  tokenHits = {};
  ctx = makeCtx();
  await Promise.all([
    ...Array.from({ length: 5 }, () => proactiveServiceTokenRefresh(ctx, "A")),
    ...Array.from({ length: 5 }, () => proactiveServiceTokenRefresh(ctx, "B")),
  ]);
  const hitsA = tokenHits["rt-A"] ?? 0;
  const hitsB = tokenHits["rt-B"] ?? 0;

  // Test 3: past-expiry recovery (the connection-status path). Start expired,
  // run the proactive refresh, then re-read auth the way connection-status does
  // and confirm tokenValid flips to true.
  tokenHits = {};
  ctx = makeCtx();
  const before = await ctx.state.get({ scopeKind: "instance", stateKey: "bridge.service.A.auth" });
  const validBefore = before?.expiresAt ? Date.now() < before.expiresAt : false;
  await proactiveServiceTokenRefresh(ctx, "A");
  const after = await ctx.state.get({ scopeKind: "instance", stateKey: "bridge.service.A.auth" });
  const validAfter = after?.expiresAt ? Date.now() < after.expiresAt : false;
  const recovered = validBefore === false && validAfter === true && after.accessToken === "new-rt-A";

  const pass = sameService === 1 && hitsA === 1 && hitsB === 1 && recovered;
  console.log(`Test 1 — 8 concurrent same-service refreshes => token endpoint hits: ${sameService} (expect 1)`);
  console.log(`Test 2 — concurrent A+B refreshes => A hits: ${hitsA}, B hits: ${hitsB} (expect 1 and 1)`);
  console.log(`Test 3 — past-expiry recovery => tokenValid before: ${validBefore}, after silent refresh: ${validAfter} (expect false then true)`);
  console.log(pass ? "RESULT: PASS — dedup is per-service/independent and tokenValid recovers past expiry" : "RESULT: FAIL");
  process.exit(pass ? 0 : 1);
}

run();
