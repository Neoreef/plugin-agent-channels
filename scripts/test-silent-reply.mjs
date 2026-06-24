#!/usr/bin/env node
/**
 * NEO-209 — broadcast self-selection (silent-token) test.
 *
 * In a broadcast channel every agent sees every message; each emits the silent
 * token when it has nothing to add and we suppress that reply. This pins the
 * matcher: token-shaped replies (with reasonable model wrapping) are silent,
 * while real messages — including ones that merely mention the word "silent" —
 * are delivered.
 *
 * Run after `npm run build`:  node scripts/test-silent-reply.mjs
 */

import assert from "node:assert/strict";
import { isSilentReply, broadcastSelfSelectGuidance, SILENT_REPLY_TOKEN } from "../dist/modules/cliq/silent-reply.js";

let passed = 0;
const ok = (msg) => { passed++; console.log(`  ✓ ${msg}`); };

console.log("Silent-reply suppression");

// Suppressed: the bare token and tolerated model wrappings.
for (const t of [
  SILENT_REPLY_TOKEN,
  "  <SILENT>  ",
  "<SILENT>\n",
  "```\n<SILENT>\n```",
  "SILENT",
  "[SILENT]",
  "*silent*",
  "NO_REPLY",
]) {
  assert.equal(isSilentReply(t), true, `should be silent: ${JSON.stringify(t)}`);
}
ok("bare token + wrapped/bracketless variants are suppressed");

// Delivered: real messages must pass through, even when they reference the word.
for (const t of [
  "Yes, let's ship it.",
  "I think we should stay silent on this externally until launch.",
  "The silent treatment won't help — let's reply to the customer.",
  "Sure, on it.",
  "<SILENT> but actually here's my take: ...",
]) {
  assert.equal(isSilentReply(t), false, `should deliver: ${JSON.stringify(t)}`);
}
ok("real replies (incl. ones mentioning 'silent') are delivered");

// Empty/undefined is not itself a token (handler treats empty broadcast turns
// separately) — guard the matcher's contract.
assert.equal(isSilentReply(""), false);
assert.equal(isSilentReply(undefined), false);
ok("empty/undefined is not matched as the token");

// Guidance must name the exact token the matcher expects.
assert.ok(broadcastSelfSelectGuidance().includes(SILENT_REPLY_TOKEN), "guidance references the token");
ok("self-selection guidance instructs the exact token");

console.log(`\n${passed} checks passed.`);
