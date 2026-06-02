/**
 * Cliq webhook handler.
 *
 * Receives DM messages from Cliq bots, routes to Paperclip agent sessions,
 * and streams the response back via message edit-in-place.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { resolveBot } from "./bot-mapping.js";
import {
  sendCliqMessage,
  getChatEditCapability,
  setChatEditCapability,
} from "../../lib/cliq-client.js";
import { runAgentChat, type HarnessEvent } from "../../lib/harness.js";
import { createCliqDraftStream } from "../../lib/draft-stream.js";
import { handleApprovalButton } from "../notifications/approvals.js";
import type { ActiveQuery } from "../../lib/types.js";

/** Active queries — prevents concurrent sessions per user+agent */
const activeQueries = new Map<string, ActiveQuery>();

function queryKey(userId: string, agentId: string): string {
  return `${userId}:${agentId}`;
}

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
  chat?: { id?: string; type?: string };
  message?: string;
  text?: string;
  type?: string;
  // Button callbacks (Deluge agentChannelsButtonCallback): { type, key }
  key?: string;
};

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
  const messageText = payload.message ?? payload.text ?? "";
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

  if (!messageText.trim()) {
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
  const key = queryKey(userId, agentId);

  // Concurrent query guard
  const existing = activeQueries.get(key);
  if (existing) {
    const elapsed = Date.now() - existing.startedAt;
    if (elapsed < 10 * 60_000) {
      await sendCliqMessage(
        ctx,
        botUniqueName,
        userId,
        `I'm still working on your previous request. Please wait for it to finish.`,
      );
      return;
    }
    // Stale — allow override
    activeQueries.delete(key);
  }

  ctx.logger.info(`Cliq: ${userName} → ${botUniqueName} (agent=${agentId}): "${messageText.slice(0, 100)}"`);

  const chatId = (payload.chat as { id?: string } | undefined)?.id;

  // Mark active BEFORE returning so a rapid follow-up message hits the
  // concurrent-query guard above.
  activeQueries.set(key, { userId, agentId, sessionId: "", startedAt: Date.now() });

  // CRITICAL: do NOT await the harness here. The host's webhook RPC has a ~30s
  // budget, but an agent turn (persona + tools + model latency) routinely runs
  // longer. Awaiting it inside onWebhook makes the RPC time out at 30s (502)
  // while the harness keeps running orphaned. Instead we detach the work: the
  // webhook returns immediately and the reply is delivered later via the Cliq
  // API (bot message / edit-in-place), which works any time the worker is alive.
  void runChatInBackground(ctx, {
    key,
    chatId,
    botUniqueName,
    userId,
    agentId,
    companyId,
    messageText,
  }).catch((err) => {
    ctx.logger.error(`Cliq background chat crashed: ${String(err)}`);
    activeQueries.delete(key);
  });
}

type BackgroundChatArgs = {
  key: string;
  chatId: string | undefined;
  botUniqueName: string;
  userId: string;
  agentId: string;
  companyId: string;
  messageText: string;
};

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
  const { key, chatId, botUniqueName, userId, agentId, companyId, messageText } = args;
  const editable = chatId ? getChatEditCapability(chatId) : null;

  try {
    // Known non-editable chat: no streaming possible — run to completion and
    // deliver once as a plain message.
    if (editable === false) {
      const result = await runAgentChat(ctx, { agentId, companyId }, {
        prompt: messageText,
        timeoutMs: 300_000,
      });
      logDone(ctx, agentId, result);
      await sendCliqMessage(ctx, botUniqueName, userId, finalTextOf(result));
      return;
    }

    // Streaming path: a single card edited in place as the turn progresses.
    const stream = createCliqDraftStream({
      ctx,
      botName: botUniqueName,
      userId,
      agentName: titleCaseTool(botUniqueName),
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
    });
    logDone(ctx, agentId, result);

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
      await sendCliqMessage(ctx, botUniqueName, userId, finalText);
    } else if (cid) {
      setChatEditCapability(cid, true);
    }
  } catch (err) {
    ctx.logger.error(`Agent invoke failed: ${String(err)}`);
    await sendCliqMessage(
      ctx,
      botUniqueName,
      userId,
      `Sorry, I encountered an error: ${String(err).slice(0, 200)}`,
    );
  } finally {
    activeQueries.delete(key);
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
