#!/usr/bin/env node
/**
 * NEO-209 — session policy-fingerprint reset test.
 *
 * Static channel guidance is baked into the session system prompt at creation,
 * so a changed channel policy must RESET the session (board feedback: settings
 * changes reset the conversation). This pins:
 *   - policyFingerprint is deterministic and changes with broadcast/guidance,
 *   - resolveSession resumes when the fingerprint is unchanged,
 *   - resolveSession reports a policy_changed reset (no resume) when it differs,
 *   - a first-time fingerprint (none stored) resumes rather than spuriously
 *     resetting.
 *
 * Run after `npm run build`:  node scripts/test-session-policy.mjs
 */

import assert from "node:assert/strict";
import { policyFingerprint, resolveSession, saveSession } from "../dist/modules/cliq/session-store.js";

let passed = 0;
const ok = (msg) => { passed++; console.log(`  ✓ ${msg}`); };

// Fake PluginContext with in-memory instance state.
function fakeCtx() {
  const store = new Map();
  return {
    state: {
      async get({ stateKey }) { return store.has(stateKey) ? store.get(stateKey) : null; },
      async set({ stateKey }, value) { store.set(stateKey, value); },
    },
  };
}

console.log("Session policy fingerprint");

// Deterministic + sensitive to the inputs that shape the system prompt.
const a = policyFingerprint({ broadcast: true, channelGuidance: "be terse" });
assert.equal(a, policyFingerprint({ broadcast: true, channelGuidance: "be terse" }));
assert.notEqual(a, policyFingerprint({ broadcast: false, channelGuidance: "be terse" }));
assert.notEqual(a, policyFingerprint({ broadcast: true, channelGuidance: "be verbose" }));
assert.notEqual(a, policyFingerprint({ broadcast: true }));
ok("fingerprint is deterministic and varies with broadcast + guidance");

const key = "chan:C1:agentA";

// No stored session → no resume, no reset.
let ctx = fakeCtx();
assert.deepEqual(await resolveSession(ctx, key, a), {});
ok("no stored session → fresh (no resume, no reset)");

// Same fingerprint → resume.
ctx = fakeCtx();
await saveSession(ctx, key, "sess-1", a);
assert.deepEqual(await resolveSession(ctx, key, a), { resumeSessionId: "sess-1" });
ok("unchanged policy → resumes the session");

// Changed fingerprint → policy_changed reset (no resume).
const b = policyFingerprint({ broadcast: false, channelGuidance: "be terse" });
assert.deepEqual(await resolveSession(ctx, key, b), { resetReason: "policy_changed" });
ok("changed policy → reports policy_changed, no resume");

// Session saved without a fingerprint (e.g. pre-existing/DM) → resume, never a
// spurious reset.
ctx = fakeCtx();
await saveSession(ctx, key, "sess-2"); // no fingerprint
assert.deepEqual(await resolveSession(ctx, key, a), { resumeSessionId: "sess-2" });
ok("first-time fingerprint does not spuriously reset");

console.log(`\n${passed} checks passed.`);
