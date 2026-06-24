#!/usr/bin/env node
/**
 * NEO-206 — Cliq participation payload normalization test.
 *
 * Replays a captured **channel participation** payload and a **DM** payload
 * through the exact pure helpers `handleCliqWebhook` uses, proving:
 *   - channel text is extracted from `data.message.text` (was dropped as empty),
 *   - the channel is detected from `chat.channel_unique_name` / `chat.type`,
 *   - the bot mention is recognized from `data.message.mentions` (and via a
 *     last-resort text scan),
 *   - both shapes survive every pre-dispatch guard → reach `runChatInBackground`,
 *   - the DM shape still parses and dispatches (regression).
 *
 * These are the same functions the handler composes; see webhook-handler.ts.
 * Run after `npm run build`:  node scripts/test-cliq-payload.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  extractMessageText,
  resolveOperation,
  extractCliqContext,
  extractChannelContext,
  botWasMentioned,
} from "../dist/modules/cliq/webhook-handler.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(path.join(here, "fixtures", name), "utf8"));

let passed = 0;
const ok = (msg) => { passed++; console.log(`  ✓ ${msg}`); };

/**
 * Mirror of the handler's pre-dispatch decision: would this payload reach
 * runChatInBackground, or be dropped by a guard? Returns the resolved fields
 * too so the test can assert on them.
 */
function decide(payload, botUniqueName, requireMention, isMentionDelivery = false) {
  const messageText = extractMessageText(payload);
  // Mirror the handler's identity resolution: bot id is the only hard
  // requirement; sender id is optional and defaults to "" (NEO-206).
  const botId = payload.bot_unique_name ?? payload.bot?.unique_name;
  const userId = payload.sender?.id ?? payload.user?.id ?? "";
  const { operation, isMessageOp, isSilent } = resolveOperation(payload);
  const { repliedText, files, reactions } = extractCliqContext(payload);
  const ch = extractChannelContext(payload, payload.chat?.id, userId);

  if (!botId) return { dispatched: false, reason: "no bot id", messageText, ch, operation };
  if (isSilent) return { dispatched: false, reason: "silent op", messageText, ch, operation };
  if (isMessageOp && !messageText.trim() && files.length === 0 && !repliedText && reactions.length === 0) {
    return { dispatched: false, reason: "empty message", messageText, ch, operation };
  }
  // DM with no sender id cannot be answered; a channel routes on the chat id and
  // proceeds without one (the regression that dropped every channel message).
  if (!ch.isChannel && !userId) {
    return { dispatched: false, reason: "dm no sender", messageText, ch, operation };
  }
  // A dedicated MentionHandler delivery IS the mention (Zoho only fires it for
  // the mentioned bot) — it bypasses payload-based detection, which can't match
  // Cliq's display-name/id mention representation to the bot's unique_name.
  if (ch.isChannel && isMessageOp && requireMention && !isMentionDelivery && !botWasMentioned(ch.mentions, botUniqueName, messageText)) {
    return { dispatched: false, reason: "not mentioned", messageText, ch, operation };
  }
  if (ch.isChannel && !isMessageOp) {
    return { dispatched: false, reason: "roster op", messageText, ch, operation };
  }
  return { dispatched: true, reason: "ok", messageText, ch, operation, repliedText, files };
}

function main() {
  // ─── 1. Channel participation payload (the NEO-205 drop) ───────────────────
  const channel = load("cliq-participation-channel.json");
  const c = decide(channel, "marc", /* requireMention */ true);

  assert.equal(c.messageText, "@marc can you review the deploy?");
  ok("channel: text extracted from data.message.text (no longer empty)");

  assert.equal(c.ch.isChannel, true);
  assert.equal(c.ch.channelName, "engineering");
  ok("channel: detected from chat.channel_unique_name");

  assert.equal(botWasMentioned(c.ch.mentions, "marc", c.messageText), true);
  ok("channel: bot mention recognized from data.message.mentions");

  assert.equal(c.repliedText, "deploy went out at 3pm");
  ok("channel: reply context read from data.message.replied_message");

  assert.equal(c.dispatched, true, `expected dispatch, got drop: ${c.reason}`);
  ok("channel: survives all guards → reaches runChatInBackground");

  // ─── 2. Mention via last-resort text scan (no mentions array) ──────────────
  const noArray = structuredClone(channel);
  delete noArray.data.message.mentions;
  const c2 = decide(noArray, "marc", true);
  assert.equal(c2.dispatched, true, `expected dispatch via text scan, got: ${c2.reason}`);
  ok("channel: mention recognized via @unique_name text scan fallback");

  // A different bot that is NOT mentioned stays silent under requireMention.
  const c3 = decide(noArray, "werner", true);
  assert.equal(c3.dispatched, false);
  assert.equal(c3.reason, "not mentioned");
  ok("channel: unmentioned bot is correctly gated out");

  // ─── 2b. Channel message with NO sender id still dispatches (NEO-206) ──────
  // The participation Deluge script can post without `sender.id`; the old
  // working monitor tolerated this, the ported handler wrongly required it and
  // silently dropped every channel message (mention or not). Regression guard.
  const noSender = structuredClone(channel);
  delete noSender.sender;
  const cNoSender = decide(noSender, "marc", true);
  assert.equal(cNoSender.ch.isChannel, true);
  assert.equal(cNoSender.dispatched, true, `channel w/o sender id expected dispatch, got: ${cNoSender.reason}`);
  ok("channel: message with no sender id still dispatches (was silently dropped)");

  // ─── 2c. Channel @mention via the dedicated MentionHandler (NEO-206) ──────
  // The real MentionHandler payload: chat.type "groupchat", top-level message,
  // and a `mentions` array using Cliq's display-name/id form ("Marc"/numeric id)
  // that does NOT match the bot's unique_name "marc". Without honoring the
  // handler-name signal, requireMention gates it out — the live bug.
  const mention = load("cliq-mention-channel.json");
  assert.equal(extractChannelContext(mention, mention.chat.id, mention.sender.id).isChannel, true);
  assert.equal(botWasMentioned(mention.mentions, "marc", extractMessageText(mention)), false,
    "payload mention form should NOT match unique_name (that's why we need the header)");
  // Without the mention-delivery signal → wrongly gated:
  assert.equal(decide(mention, "marc", true, /* isMentionDelivery */ false).reason, "not mentioned");
  // With it → dispatches to the channel:
  const md = decide(mention, "marc", true, /* isMentionDelivery */ true);
  assert.equal(md.dispatched, true, `mention delivery expected dispatch, got: ${md.reason}`);
  ok("channel: MentionHandler delivery dispatches despite unmatched payload mentions");

  // ─── 3. groupchat chat.type also counts as a channel ──────────────────────
  const groupchat = structuredClone(channel);
  groupchat.chat.type = "groupchat";
  delete groupchat.chat.channel_unique_name;
  assert.equal(extractChannelContext(groupchat, groupchat.chat.id, "u-1").isChannel, true);
  ok("channel: chat.type \"groupchat\" detected as a channel");

  // ─── 4. Silent + roster operations ────────────────────────────────────────
  const closed = structuredClone(channel);
  closed.operation = "thread_closed";
  assert.equal(decide(closed, "marc", true).dispatched, false);
  assert.equal(resolveOperation(closed).isSilent, true);
  ok("op thread_closed: skipped (silent)");

  const added = structuredClone(channel);
  added.operation = "added";
  added.data.message = {};
  const a = decide(added, "marc", true);
  assert.equal(a.dispatched, false);
  assert.equal(a.reason, "roster op");
  ok("op added: treated as roster update, not a chat turn");

  // ─── 5. DM regression — top-level message + message_details still works ────
  const dm = load("cliq-dm.json");
  const d = decide(dm, "marc", true);
  assert.equal(d.messageText, "hello marc, what's the status?");
  assert.equal(d.ch.isChannel, false);
  assert.equal(d.operation, "message_sent"); // default for the legacy handler
  assert.equal(d.dispatched, true, `DM expected dispatch, got: ${d.reason}`);
  ok("DM: top-level message parses, not a channel, reaches dispatch (regression)");

  // A DM with no sender id cannot be answered → correctly dropped (the guard
  // that, mis-applied to channels, caused NEO-206).
  const dmNoSender = structuredClone(dm);
  delete dmNoSender.sender;
  delete dmNoSender.user;
  const dn = decide(dmNoSender, "marc", true);
  assert.equal(dn.dispatched, false);
  assert.equal(dn.reason, "dm no sender");
  ok("DM: no sender id is dropped (cannot route a reply), unlike a channel");

  console.log(`\n✅ test-cliq-payload: ${passed} assertions passed`);
}

main();
