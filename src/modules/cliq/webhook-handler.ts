/**
 * Cliq webhook handler.
 *
 * Receives DM messages from Cliq bots, routes to Paperclip agent sessions,
 * and streams the response back via message edit-in-place.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { resolveBot } from "./bot-mapping.js";
import { sendCliqMessage } from "../../lib/cliq-client.js";
import { runAgentChat } from "../../lib/harness.js";
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

  // Create draft stream for streaming response
  // Invoke the agent's harness directly (conversational turn), then deliver the
  // reply as a single message. We don't stream/edit-in-place: Cliq returns bot
  // message ids that don't round-trip through the edit endpoint, leaving the
  // card stuck on "waiting". The Deluge handler's synchronous "Processing…"
  // already serves as the wait indicator.
  try {
    activeQueries.set(key, { userId, agentId, sessionId: "", startedAt: Date.now() });

    const result = await runAgentChat(ctx, { agentId, companyId }, {
      prompt: messageText,
      timeoutMs: 300_000,
    });

    ctx.logger.info(
      `[done] agent=${agentId} len=${result.text.length} session=${result.sessionId ?? "-"}${result.error ? ` error=${result.error}` : ""} final="${result.text.slice(0, 200).replace(/\n/g, "\\n")}"`,
    );

    const finalText = result.text
      || (result.error ? `Sorry — ${result.error}` : "_(No response from agent.)_");
    await sendCliqMessage(ctx, botUniqueName, userId, finalText);
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
