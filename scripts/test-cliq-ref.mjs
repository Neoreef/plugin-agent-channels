#!/usr/bin/env node
/**
 * NEO-275 — Cliq send-response ref resolution test.
 *
 * The draft stream edits a single Cliq message in place by holding its ref
 * ({chatId, messageId}). A streaming reply was posting every chunk as a fresh
 * message ("ERROR draft-stream: sent but no ref returned") because the card send
 * goes to POST /chats/{chatId}/message, whose response echoes message_id but NOT
 * chat_id (it's already in the URL). With no chatId the ref is unusable.
 *
 * `resolveCardMessageRef` re-attaches the known chat id so the ref is complete
 * and editable. This test replays the real response shapes and proves:
 *   - chat-post response (message_id, no chat_id) → ref gains the known chatId,
 *   - bot DM response (message_details with chat_id) → unchanged extraction,
 *   - a refless response (no message_id) → still yields no messageId, so the
 *     stream can detect it and degrade to send-final-once.
 *
 * Run after `npm run build`:  node scripts/test-cliq-ref.mjs
 */

import assert from "node:assert/strict";
import { resolveCardMessageRef } from "../dist/lib/cliq-client.js";

let passed = 0;
const ok = (msg) => { passed++; console.log(`  ✓ ${msg}`); };

function main() {
  const userId = "u-123";
  const chatId = "CH-DEADBEEF";

  // ─── 1. Chat-post response: message_id present, chat_id absent (NEO-275) ────
  // POST /chats/{chatId}/message returns the created message without chat_id.
  const chatPost = { id: "1780350234100 45183446516", time: "1780350234100" };
  const r1 = resolveCardMessageRef(chatPost, userId, chatId);
  assert.equal(r1.messageId, "1780350234100 45183446516", "message id extracted from root id");
  assert.equal(r1.chatId, chatId, "known chatId re-attached when body omits it");
  ok("chat-post (no chat_id in body): ref completed with known chatId — editable");

  // ─── 2. Bot DM response: message_details carries chat_id + message_id ───────
  const botDm = {
    message_details: {
      [userId]: { chat_id: "CH-FROM-BODY", message_id: "999%20111" },
    },
  };
  const r2 = resolveCardMessageRef(botDm, userId, chatId);
  assert.equal(r2.chatId, "CH-FROM-BODY", "body chat_id wins; known chatId is only a fallback");
  assert.equal(r2.messageId, "999 111", "composite message id URL-decoded");
  ok("bot-DM response: body chat_id preserved (fallback does not override)");

  // ─── 3. Refless response: no message_id anywhere → degrade signal ───────────
  // A send path that structurally can't return a ref must leave messageId unset
  // so the draft stream switches to send-final-once instead of editing nothing.
  const refless = { status: "success", message: "queued" };
  const r3 = resolveCardMessageRef(refless, userId, chatId);
  assert.equal(r3.chatId, chatId, "chatId still attached");
  assert.equal(r3.messageId, undefined, "no message_id → ref not editable (triggers degrade)");
  ok("refless response: no messageId surfaces, so stream can degrade gracefully");

  // ─── 4. No known chatId and none in body → both undefined (no crash) ───────
  const r4 = resolveCardMessageRef({}, userId, undefined);
  assert.equal(r4.chatId, undefined);
  assert.equal(r4.messageId, undefined);
  ok("empty response + no known chat: returns empty ref without throwing");

  console.log(`\n✅ test-cliq-ref: ${passed} assertions passed`);
}

main();
