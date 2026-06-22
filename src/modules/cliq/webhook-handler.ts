/**
 * Cliq webhook handler.
 *
 * Receives DM messages from Cliq bots, routes to Paperclip agent sessions,
 * and streams the response back via message edit-in-place.
 */

import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { resolveBot } from "./bot-mapping.js";
import {
  sendCliqMessage,
  sendCliqChatMessage,
  getChatEditCapability,
  setChatEditCapability,
  downloadCliqFile,
} from "../../lib/cliq-client.js";
import { runAgentChat, type HarnessEvent } from "../../lib/harness.js";
import { createCliqDraftStream } from "../../lib/draft-stream.js";
import {
  getResumeSession,
  saveSession,
  dmConversationKey,
  channelConversationKey,
} from "./session-store.js";
import { honchoEnabled, resolveHonchoScope, recordHonchoTurn, honchoRecall } from "../../lib/honcho.js";
import { handleApprovalButton } from "../notifications/approvals.js";
import {
  noteHumanParticipant,
  recordChannelBot,
  getChannelParticipants,
  renderRoster,
} from "./roster.js";
import {
  isBotSender,
  resolveMessageDepth,
  checkGuardrails,
  recordAgentMessage,
} from "./guardrails.js";
import { readGroupsConfig, resolveGroupPolicy } from "./group-policy.js";
import type { ActiveQuery } from "../../lib/types.js";

/** Per-channel rolling history of recent messages (sender + text), for context
 *  injection — including messages an agent saw but didn't respond to (not
 *  @mentioned). In-memory, capped per channel. */
const CHANNEL_HISTORY_LIMIT = 15;
const channelHistory = new Map<string, Array<{ sender: string; text: string }>>();
function recordChannelHistory(channelId: string, sender: string, text: string): void {
  if (!text.trim()) return;
  const arr = channelHistory.get(channelId) ?? [];
  arr.push({ sender, text: text.slice(0, 500) });
  while (arr.length > CHANNEL_HISTORY_LIMIT) arr.shift();
  channelHistory.set(channelId, arr);
}
function renderChannelHistory(channelId: string): string | undefined {
  const arr = channelHistory.get(channelId);
  if (!arr || arr.length === 0) return undefined;
  return `Recent messages in this channel:\n${arr.map((m) => `${m.sender}: ${m.text}`).join("\n")}`;
}

/** Active queries — prevents concurrent runs per conversation (keyed by convKey). */
const activeQueries = new Map<string, ActiveQuery>();

/** Channels we've already emitted the one-time payload-shape probe for. */
const loggedChannelProbe = new Set<string>();

/**
 * Sanitize Cliq webhook payload.
 * Deluge injects control characters that break JSON.parse.
 */
function sanitizePayload(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

type CliqWebhookPayload = {
  // Deluge handlers send bot_unique_name at the top level
  bot_unique_name?: string;
  // Raw Cliq user object: { id, first_name, last_name, email, ... }
  user?: { id?: string; name?: string; first_name?: string; last_name?: string; email?: string };
  // Deluge handlers add a normalized sender object
  sender?: { id?: string; name?: string; email?: string };
  // Older/alternative shape
  bot?: { unique_name?: string; name?: string };
  chat?: { id?: string; type?: string; title?: string; channel_unique_name?: string };
  // Channel/group fields (present for channel messages)
  channel?: { unique_name?: string; name?: string };
  // @mentions in the message (Deluge sends these for channel messages)
  mentions?: Array<{ name?: string; id?: string; bot_unique_name?: string }>;
  // Self-relay markers (a bot's own/teammate reply re-entering as a channel msg)
  _relay?: boolean;
  _relayDepth?: number;
  operation?: string; // "message_sent" | "message_edited" | "added" | "removed" | "thread_closed" | ...
  message?: string;
  text?: string;
  type?: string;
  // Button callbacks (Deluge agentChannelsButtonCallback): { type, key }
  key?: string;
  // Rich context the Deluge handlers send (skill: zoho-cliq-messaging)
  message_details?: {
    message?: CliqMessageObject;
  };
  // Channel/participation handler shape: text + mentions + reply + file nest
  // under data.message (a separate Deluge script with a divergent contract).
  data?: {
    message?: CliqMessageObject;
  };
  attachments?: CliqFile[];
  // Reactions (only present once a Deluge reaction handler is added — see #30)
  reactions?: Array<{ emoji?: string; name?: string; user?: { name?: string } }>;
};

/** A Cliq file attachment — download via `url` (the hash `id` doesn't work). */
type CliqFile = { name?: string; id?: string; type?: string; url?: string };

/** A message object as nested under `message_details.message` (DM/mention
 *  handler) or `data.message` (channel participation handler). Both Deluge
 *  scripts use this same inner shape; only the wrapper differs. */
type CliqMessageObject = {
  text?: string;
  content?: { text?: string; file?: CliqFile };
  file?: CliqFile;
  mentions?: Array<{ name?: string; id?: string; bot_unique_name?: string }>;
  replied_message?: {
    text?: string;
    sender?: { name?: string };
    file?: CliqFile;
    content?: { text?: string };
  };
};

/** The message object — DM/mention handler nests it under `message_details`,
 *  the channel participation handler under `data`. Prefer whichever is present. */
function messageObjectOf(payload: CliqWebhookPayload): CliqMessageObject | undefined {
  return payload.message_details?.message ?? payload.data?.message;
}

/**
 * Extract the message text. The channel participation handler nests text under
 * `data.message.text` / `data.message.content.text`; the DM handler sends it at
 * the top level (`message`/`text`). Reading only the top level dropped every
 * channel message as "empty" (NEO-205). Mirrors old monitor.ts:204.
 */
export function extractMessageText(payload: CliqWebhookPayload): string {
  const msg = messageObjectOf(payload);
  return msg?.text ?? msg?.content?.text ?? payload.message ?? payload.text ?? "";
}

/** Resolve the participation operation and classify it. Defaults to
 *  `message_sent` for the legacy bot/DM handler (which sends no `operation`). */
export function resolveOperation(payload: CliqWebhookPayload): {
  operation: string;
  isMessageOp: boolean;
  isSilent: boolean;
} {
  const operation = payload.operation ?? "message_sent";
  return {
    operation,
    isMessageOp: operation === "message_sent" || operation === "message_edited",
    isSilent: operation === "thread_closed" || operation === "removed_from_thread",
  };
}

/** Pull reply context + file attachments + reactions out of the payload. */
export function extractCliqContext(payload: CliqWebhookPayload): {
  repliedText?: string;
  files: CliqFile[];
  reactions: string[];
} {
  const msg = messageObjectOf(payload);
  const replied = msg?.replied_message;
  const repliedText = (replied?.text ?? replied?.content?.text)?.trim() || undefined;
  const files: CliqFile[] = [];
  // File can sit at `content.file` (standard) or top-level `.file` (Cliq file
  // messages) — for both the DM and participation wrappers. Old monitor.ts:695.
  if (msg?.content?.file?.url) files.push(msg.content.file);
  if (msg?.file?.url) files.push(msg.file);
  if (replied?.file?.url) files.push(replied.file);
  for (const f of payload.attachments ?? []) if (f?.url) files.push(f);
  const reactions = (payload.reactions ?? [])
    .map((r) => r.emoji || r.name || "")
    .filter(Boolean);
  return { repliedText, files, reactions };
}

type ChannelContext = {
  isChannel: boolean;
  channelId: string;
  channelName: string;
  channelLabel: string;
  mentions: Array<{ name?: string; id?: string; bot_unique_name?: string }>;
  senderIsBot: boolean;
  relayDepth: number;
};

/** Detect channel vs DM and pull the channel routing fields out of the payload. */
export function extractChannelContext(
  payload: CliqWebhookPayload,
  chatId: string | undefined,
  senderId: string | undefined,
): ChannelContext {
  const channelName = payload.channel?.unique_name ?? payload.chat?.channel_unique_name ?? "";
  // Participation payloads set chat.type to "channel" or "groupchat"; the legacy
  // bot handler sends a separate channel field. Old monitor.ts:238-245.
  const chatType = payload.chat?.type;
  const isChannel = Boolean(channelName || chatType === "channel" || chatType === "groupchat");
  // Prefer a stable id for keying: chatId, else the channel unique name.
  const channelId = chatId || channelName;
  const channelLabel = payload.chat?.title || payload.channel?.name || (channelName ? `#${channelName}` : "channel");
  // Mentions live under data.message.mentions for participation payloads; the
  // legacy handler puts them top-level. Reading only the top level made
  // botWasMentioned always-false in channels (default requireMention:true →
  // every channel message gated out). Old monitor.ts:321.
  const mentions = payload.data?.message?.mentions ?? payload.mentions ?? [];
  return {
    isChannel,
    channelId,
    channelName,
    channelLabel,
    mentions,
    senderIsBot: isBotSender(senderId, payload._relay),
    relayDepth: payload._relayDepth ?? 0,
  };
}

/** Was this bot @mentioned in the message? Reads the structured mentions list,
 *  then falls back to scanning the raw text for `@unique_name` — some
 *  participation payloads carry the mention in the text but not the array. */
export function botWasMentioned(
  mentions: Array<{ name?: string; id?: string; bot_unique_name?: string }>,
  botUniqueName: string,
  text?: string,
): boolean {
  if (mentions.some(
    (m) => m.bot_unique_name === botUniqueName || m.name === botUniqueName || m.id === botUniqueName,
  )) return true;
  // Last-resort text scan (old monitor.ts:321). Unique names are alnum/_; a
  // case-insensitive substring on "@name" is sufficient and avoids regex escaping.
  if (text && text.toLowerCase().includes(`@${botUniqueName.toLowerCase()}`)) return true;
  return false;
}

export async function handleCliqWebhook(
  ctx: PluginContext,
  rawBody: string | undefined,
  parsedBody: unknown,
): Promise<void> {
  // Parse payload
  let payload: CliqWebhookPayload;
  if (parsedBody && typeof parsedBody === "object") {
    payload = parsedBody as CliqWebhookPayload;
  } else if (rawBody) {
    try {
      payload = JSON.parse(sanitizePayload(rawBody)) as CliqWebhookPayload;
    } catch (err) {
      ctx.logger.error(`Cliq webhook: failed to parse payload: ${String(err)}`);
      return;
    }
  } else {
    ctx.logger.error("Cliq webhook: empty payload");
    return;
  }

  const userId = payload.sender?.id ?? payload.user?.id;
  const userName =
    payload.sender?.name ??
    payload.user?.name ??
    ([payload.user?.first_name, payload.user?.last_name].filter(Boolean).join(" ") || "User");
  const botUniqueName = payload.bot_unique_name ?? payload.bot?.unique_name;
  // Reads data.message.text first (channel participation) before the top-level
  // DM fields — without this every channel message looked empty (NEO-205).
  const messageText = extractMessageText(payload);
  // Deluge payload has no bot display name; fall back to the unique name
  const botDisplayName: string | undefined = payload.bot?.name ?? botUniqueName;

  if (!userId || !botUniqueName) {
    ctx.logger.error(`Cliq webhook: missing userId or botUniqueName`);
    return;
  }

  // Button callbacks (Approve/Deny on an approval card) arrive here too.
  if (payload.type === "button_callback" && payload.key) {
    const handled = await handleApprovalButton(ctx, payload.key, userId, botUniqueName);
    if (handled) return;
  }

  // Operation-aware gating: the participation handler tags events with an
  // operation; the legacy DM/bot handler sends none (default "message_sent").
  const { operation, isMessageOp, isSilent } = resolveOperation(payload);
  if (isSilent) {
    ctx.logger.info(`Cliq webhook: ignoring operation "${operation}"`);
    return;
  }

  const { repliedText, files, reactions } = extractCliqContext(payload);

  // Empty/text-required guard applies ONLY to message ops. Roster ops
  // (added/removed) legitimately carry no text — they're handled below as
  // roster updates. Allow file-only / reply-only / reaction-only messages too
  // (empty text is valid when a file is attached — skill: zoho-cliq-messaging).
  if (isMessageOp && !messageText.trim() && files.length === 0 && !repliedText && reactions.length === 0) {
    ctx.logger.info(`Cliq webhook: empty message from ${userName}, ignoring`);
    return;
  }

  // Resolve bot → agent
  const resolved = await resolveBot(ctx, botUniqueName);
  if (!resolved) {
    ctx.logger.info(`Cliq webhook: no agent mapping for bot "${botUniqueName}"`);
    await sendCliqMessage(
      ctx,
      botUniqueName,
      userId,
      `No agent is mapped to this bot. Configure bot mappings in the Agent Channels plugin settings.`,
    );
    return;
  }

  const { agentId, companyId } = resolved;
  const chatId = (payload.chat as { id?: string } | undefined)?.id;
  const ch = extractChannelContext(payload, chatId, userId);

  // ─── Group-channel gating (policy · mention · flywheel) ─────────────────────
  let attributedText = messageText;
  let rosterContext: string | undefined;
  let channelGuidance: string | undefined;
  if (ch.isChannel) {
    // One-time per-channel probe to confirm the payload shape in prod (which
    // fields actually arrive) without spamming the log on every message.
    if (!loggedChannelProbe.has(ch.channelId)) {
      loggedChannelProbe.add(ch.channelId);
      ctx.logger.info(
        `Cliq channel probe ${ch.channelLabel}: op=${operation} chat.type=${payload.chat?.type ?? "-"} ` +
        `channel_unique_name=${payload.chat?.channel_unique_name ?? "-"} hasData.message=${Boolean(payload.data?.message)} ` +
        `mentions=${ch.mentions.length} textLen=${messageText.length}`,
      );
    }
    const groups = await readGroupsConfig(ctx);
    const policy = resolveGroupPolicy(groups, ch.channelId, ch.channelName);
    if (!policy.enabled) {
      ctx.logger.info(`Cliq channel ${ch.channelLabel}: policy disabled, ignoring`);
      return;
    }
    channelGuidance = policy.channelGuidance;

    // Roster: record this bot + (human) speaker; buffer every message for context.
    recordChannelBot(ch.channelId, { botUniqueName, agentId, displayName: botDisplayName });
    if (!ch.senderIsBot) noteHumanParticipant(ch.channelId, { id: userId, name: userName, email: payload.sender?.email ?? payload.user?.email });
    if (isMessageOp) recordChannelHistory(ch.channelId, ch.senderIsBot ? `${userName} (agent)` : userName, messageText);

    // Roster ops (added/removed) carry no message to answer — the roster is now
    // updated, so we're done.
    if (!isMessageOp) {
      ctx.logger.info(`Cliq channel ${ch.channelLabel}: roster op "${operation}", updated roster only`);
      return;
    }

    // Mention gating: when required and this bot isn't @mentioned, stay silent
    // (the message is already buffered above for later context).
    if (policy.requireMention && !botWasMentioned(ch.mentions, botUniqueName, messageText)) {
      ctx.logger.info(`Cliq channel ${ch.channelLabel}: ${botUniqueName} not mentioned, buffering only`);
      return;
    }

    // Flywheel guardrails (broadcast mode): bound bot↔bot depth + hourly volume.
    if (!policy.requireMention) {
      const depth = resolveMessageDepth({ senderIsBotMessage: ch.senderIsBot, parentDepth: ch.relayDepth });
      const gr = checkGuardrails({ agentId, channelId: ch.channelId, depth, config: policy.guardrails });
      if (!gr.allowed) {
        ctx.logger.info(`Cliq channel ${ch.channelLabel}: guardrail blocked ${botUniqueName} (${gr.reason})`);
        return;
      }
    }

    // Sender attribution — each agent sees who said what.
    if (messageText.trim()) attributedText = `${userName}: ${messageText}`;
    rosterContext = renderRoster(ch.channelId, ch.channelLabel, botUniqueName);
  }

  // Conversation key: per (channel, agent) for groups, per (user, agent) for DMs.
  const convKey = ch.isChannel ? channelConversationKey(ch.channelId, agentId) : dmConversationKey(userId, agentId);

  // Concurrent query guard (keyed per conversation).
  const existing = activeQueries.get(convKey);
  if (existing) {
    const elapsed = Date.now() - existing.startedAt;
    if (elapsed < 10 * 60_000) {
      // In a channel, stay quiet (the message is buffered); in a DM, tell the user.
      if (!ch.isChannel) {
        await sendCliqMessage(ctx, botUniqueName, userId, `I'm still working on your previous request. Please wait for it to finish.`, undefined, { companyId });
      }
      return;
    }
    activeQueries.delete(convKey); // stale — allow override
  }

  ctx.logger.info(`Cliq: ${userName} → ${botUniqueName} (agent=${agentId}${ch.isChannel ? `, ${ch.channelLabel}` : ""}): "${messageText.slice(0, 100)}"`);

  // Mark active BEFORE returning so a rapid follow-up message hits the
  // concurrent-query guard above.
  activeQueries.set(convKey, { userId, agentId, sessionId: "", startedAt: Date.now() });

  // CRITICAL: do NOT await the harness here. The host's webhook RPC has a ~30s
  // budget, but an agent turn (persona + tools + model latency) routinely runs
  // longer. Awaiting it inside onWebhook makes the RPC time out at 30s (502)
  // while the harness keeps running orphaned. Instead we detach the work: the
  // webhook returns immediately and the reply is delivered later via the Cliq
  // API (bot message / edit-in-place), which works any time the worker is alive.
  void runChatInBackground(ctx, {
    convKey,
    chatId,
    botUniqueName,
    userId,
    userName,
    agentId,
    companyId,
    messageText,
    attributedText,
    repliedText,
    files,
    reactions,
    channel: ch.isChannel
      ? { channelId: ch.channelId, channelName: ch.channelName, channelLabel: ch.channelLabel, rosterContext, channelGuidance }
      : undefined,
  }).catch((err) => {
    ctx.logger.error(`Cliq background chat crashed: ${String(err)}`);
    activeQueries.delete(convKey);
  });
}

type BackgroundChatArgs = {
  convKey: string;
  chatId: string | undefined;
  botUniqueName: string;
  userId: string;
  userName: string;
  agentId: string;
  companyId: string;
  messageText: string;
  /** messageText prefixed with the speaker name in channels (for the agent). */
  attributedText?: string;
  repliedText?: string;
  files?: CliqFile[];
  reactions?: string[];
  /** Present only for channel/group messages. */
  channel?: {
    channelId: string;
    channelName: string;
    channelLabel: string;
    rosterContext?: string;
    channelGuidance?: string;
  };
};

/**
 * Build the per-turn context the agent needs beyond its message: the replied-to
 * message (#29), downloaded attachments (#28 — images saved locally so the agent
 * can view them), and reactions (#30). Returned as plain text to prepend to the
 * prompt; the raw user message is kept separate (for memory).
 */
async function buildTurnContext(ctx: PluginContext, args: BackgroundChatArgs): Promise<string> {
  const parts: string[] = [];
  if (args.repliedText) parts.push(`[The user is replying to an earlier message: "${args.repliedText}"]`);
  for (const f of args.files ?? []) {
    if (!f.url) continue;
    const isImage = (f.type ?? "").toLowerCase().startsWith("image/");
    const bytes = await downloadCliqFile(ctx, f.url, { companyId: args.companyId });
    if (!bytes) { parts.push(`[The user attached "${f.name ?? "a file"}" but it could not be downloaded.]`); continue; }
    const safe = (f.name ?? "cliq-file").replace(/[^a-zA-Z0-9._-]+/g, "_");
    const p = path.join(os.tmpdir(), `cliq-${Date.now()}-${safe}`);
    try { writeFileSync(p, bytes); } catch { continue; }
    parts.push(isImage
      ? `[The user attached an image "${f.name ?? "image"}", saved locally at ${p} — open/read that file to view it.]`
      : `[The user attached a file "${f.name ?? "file"}" (${f.type ?? "unknown"}), saved at ${p}.]`);
  }
  if (args.reactions?.length) parts.push(`[The user reacted with: ${args.reactions.join(" ")}]`);
  return parts.join("\n");
}

/** "WriteFile" / "web_search" → "Write File" / "Web Search" for the tool card. */
function titleCaseTool(name: string): string {
  return name
    .split(/(?=[A-Z])|[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Runs the agent turn and delivers the reply via the card draft stream
 * (waiting → reasoning → tool → message, edited in place). Detached from the
 * webhook RPC so long turns don't blow the host's 30s webhook budget.
 *
 * Edit-in-place works for most chats but 400/403s for some users/grants. When a
 * chat is known non-editable (cached) we skip streaming and send the final
 * answer once. Otherwise we stream; if the stream learns edits fail mid-turn,
 * we cache that and deliver the final answer as a plain message.
 */
async function runChatInBackground(
  ctx: PluginContext,
  args: BackgroundChatArgs,
): Promise<void> {
  const { convKey, chatId, botUniqueName, userId, agentId, companyId, messageText } = args;
  const ch = args.channel;
  const editable = chatId ? getChatEditCapability(chatId) : null;

  // Resume this conversation's prior session for multi-turn memory (per channel
  // for groups, per user for DMs).
  const resumeSessionId = await getResumeSession(ctx, convKey);

  // Honcho memory scope — group-aware: a channel-keyed multi-peer session whose
  // peers are all known participants; a per-(user,agent) session for DMs.
  const honchoScope = honchoEnabled()
    ? await resolveHonchoScope(ctx, {
        companyId,
        agentId,
        channelUserId: userId,
        group: ch
          ? { channelId: ch.channelId, participantCliqIds: getChannelParticipants(ch.channelId).map((p) => p.id) }
          : undefined,
      }).catch((e) => {
        ctx.logger.info(`Honcho scope resolve failed: ${String(e)}`);
        return null;
      })
    : null;
  // Plugin-recall about the current speaker. Combined with channel guidance,
  // the roster, and recent channel history into the system-level context.
  const honchoRecallText = honchoScope ? (await honchoRecall(ctx, honchoScope, messageText)) ?? undefined : undefined;
  const memoryContext = [
    ch?.channelGuidance,
    ch?.rosterContext,
    ch ? renderChannelHistory(ch.channelId) : undefined,
    honchoRecallText,
  ].filter((s) => s && s.trim()).join("\n\n") || undefined;
  if (memoryContext) ctx.logger.info(`Context injected: ${memoryContext.length} chars${ch ? " (channel)" : ""}`);

  // Enrich the prompt with reply context + downloaded attachments + reactions
  // (#28/#29/#30). In channels the message is sender-attributed ("Name: text");
  // the raw messageText is kept for memory.
  const turnContext = await buildTurnContext(ctx, args);
  const agentMessage = args.attributedText ?? messageText;
  const agentPrompt = [turnContext, agentMessage].filter((s) => s && s.trim()).join("\n\n")
    || "[The user sent an attachment with no message text.]";
  if (turnContext) ctx.logger.info(`Cliq context: ${turnContext.slice(0, 120).replace(/\n/g, " ")}`);

  try {
    // Channel/group path: deliver the final answer to the CHANNEL (no in-place
    // card stream yet — the draft stream is DM-card oriented). Posts via the
    // chat id so every participant sees it.
    if (ch) {
      const result = await runAgentChat(ctx, { agentId, companyId }, {
        prompt: agentPrompt,
        timeoutMs: 300_000,
        resumeSessionId,
        channelUserId: userId,
        honcho: honchoScope ?? undefined,
        memoryContext,
      });
      logDone(ctx, agentId, result);
      await saveSession(ctx, convKey, result.sessionId);
      const finalText = finalTextOf(result);
      if (chatId) await sendCliqChatMessage(ctx, chatId, finalText, { companyId });
      else await sendCliqMessage(ctx, botUniqueName, userId, finalText, undefined, { companyId }); // fallback
      // Buffer our own reply for channel context + count it against the flywheel.
      recordChannelHistory(ch.channelId, `${botUniqueName} (agent)`, result.text);
      recordAgentMessage(agentId, ch.channelId);
      if (honchoScope) await recordHonchoTurn(ctx, honchoScope, messageText, result.text);
      return;
    }

    // Known non-editable chat: no streaming possible — run to completion and
    // deliver once as a plain message.
    if (editable === false) {
      const result = await runAgentChat(ctx, { agentId, companyId }, {
        prompt: agentPrompt,
        timeoutMs: 300_000,
        resumeSessionId,
        channelUserId: userId,
        honcho: honchoScope ?? undefined,
        memoryContext,
      });
      logDone(ctx, agentId, result);
      await saveSession(ctx, convKey, result.sessionId);
      await sendCliqMessage(ctx, botUniqueName, userId, finalTextOf(result), undefined, { companyId });
      if (honchoScope) await recordHonchoTurn(ctx, honchoScope, messageText, result.text);
      return;
    }

    // Streaming path: a single card edited in place as the turn progresses.
    const stream = createCliqDraftStream({
      ctx,
      botName: botUniqueName,
      userId,
      agentName: titleCaseTool(botUniqueName),
      companyId,
      chatId,
    });
    await stream.setCardState({ kind: "waiting", title: "Waiting" });

    const onEvent = (ev: HarnessEvent): void => {
      // Once we're rendering the answer, ignore late reasoning/tool events.
      if (ev.type === "thinking") {
        if (stream.getCardState().kind === "message" && stream.hasSent()) return;
        void stream.setCardState({ kind: "reasoning", title: "Thinking" });
        if (ev.text) stream.update(ev.text);
      } else if (ev.type === "tool_use") {
        if (stream.getCardState().kind === "message" && stream.hasSent()) return;
        const title = titleCaseTool(ev.toolName);
        void stream.setCardState({ kind: "tool", title, toolName: title });
        if (ev.description) stream.update(ev.description);
      } else if (ev.type === "text_delta") {
        if (stream.getCardState().kind !== "message") void stream.setCardState({ kind: "message" });
        if (ev.text) stream.update(ev.text);
      }
    };

    const result = await runAgentChat(ctx, { agentId, companyId }, {
      prompt: messageText,
      timeoutMs: 300_000,
      onEvent,
      resumeSessionId,
      channelUserId: userId,
      honcho: honchoScope ?? undefined,
        memoryContext,
    });
    logDone(ctx, agentId, result);
    await saveSession(ctx, convKey, result.sessionId);

    // Finalize: render the authoritative final text and stop the stream.
    const finalText = finalTextOf(result);
    await stream.setCardState({ kind: "message" });
    stream.update(finalText);
    await stream.stop();

    // Learn + cache edit capability; if edits failed mid-stream, the streamed
    // card is stale — deliver the final answer as a plain message.
    const cid = stream.messageRef()?.chatId ?? chatId;
    if (stream.editsDisabled()) {
      if (cid) setChatEditCapability(cid, false);
      ctx.logger.info(`Cliq edit not supported for chat; sent plain fallback`);
      await sendCliqMessage(ctx, botUniqueName, userId, finalText, undefined, { companyId });
    } else if (cid) {
      setChatEditCapability(cid, true);
    }

    // Plugin-write: record the turn to Honcho off the agent loop (after delivery).
    if (honchoScope) await recordHonchoTurn(ctx, honchoScope, messageText, result.text);
  } catch (err) {
    ctx.logger.error(`Agent invoke failed: ${String(err)}`);
    await sendCliqMessage(
      ctx,
      botUniqueName,
      userId,
      `Sorry, I encountered an error: ${String(err).slice(0, 200)}`,
      undefined,
      { companyId },
    );
  } finally {
    activeQueries.delete(convKey);
  }
}

function finalTextOf(result: { text: string; error?: string }): string {
  return result.text || (result.error ? `Sorry — ${result.error}` : "_(No response from agent.)_");
}

function logDone(ctx: PluginContext, agentId: string, result: { text: string; sessionId?: string; error?: string }): void {
  ctx.logger.info(
    `[done] agent=${agentId} len=${result.text.length} session=${result.sessionId ?? "-"}${result.error ? ` error=${result.error}` : ""} final="${result.text.slice(0, 200).replace(/\n/g, "\\n")}"`,
  );
}
