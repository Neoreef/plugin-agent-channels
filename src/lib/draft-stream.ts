/**
 * Cliq draft stream — streaming card message with edit-in-place.
 *
 * Manages a single Cliq message that transitions between card states
 * (waiting → reasoning → tool → message) via a drain loop gated by
 * the rate limiter's slot availability.
 *
 * Adapted from ~/.claude-agent/src/draft-stream.ts to use plugin context.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { sendCliqCardMessage, editCliqMessage, deleteCliqMessage } from "./cliq-client.js";
import type { CliqMessageRef, CliqButton } from "./cliq-client.js";
import { curveWaitMs, stats as rateLimiterStats } from "./rate-limiter.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CardKind = "message" | "reasoning" | "tool" | "waiting";

export interface CardState {
  kind: CardKind;
  title?: string;
  toolName?: string;
  buttons?: CliqButton[];
  agentName?: string;
}

export interface DraftStreamParams {
  ctx: PluginContext;
  botName: string;
  userId: string;
  agentName?: string;
  initialRef?: CliqMessageRef;
  /** Company that owns this conversation — scopes the Zoho token (NEO-79). */
  companyId?: string;
  /** Specific channel service to authenticate as (optional). */
  serviceId?: string;
  /** Target chat ID if known. */
  chatId?: string;
}

export type CliqDraftStream = {
  update: (text: string) => void;
  flush: (force?: boolean) => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
  messageRef: () => CliqMessageRef | null;
  hasSent: () => boolean;
  getCardState: () => CardState;
  setCardState: (state: CardState) => Promise<void>;
  /** True once an edit returned 400/403 and the stream stopped editing. */
  editsDisabled: () => boolean;
};

const CHUNK_LIMIT = 3500;
const DRAIN_POLL_MS = 50;
const STOP_BUTTON_THRESHOLD_MS = 5000;

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createCliqDraftStream(params: DraftStreamParams): CliqDraftStream {
  const { ctx } = params;
  // Company/service scope so every send/edit/delete uses the right Zoho token.
  const scope = { companyId: params.companyId, serviceId: params.serviceId };

  let currentRef: CliqMessageRef | null = params.initialRef ?? null;
  let didSend = !!params.initialRef?.chatId;
  let stopped = false;
  let pendingText: string | null = null;
  let lastUpdateText = "";
  let animationTimer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  let finalisedCharCount = 0;
  let lastSentText = "";
  const finalisedRefs: CliqMessageRef[] = [];
  let editDisabled = false;
  let finalizing = false;
  // Set when a send succeeds but returns no editable message ref (no messageId).
  // We can't edit in place, so we stop streaming intermediate chunks (which would
  // post as separate fresh messages) and let the final flush deliver the whole
  // answer as a single message instead — "send final once" (NEO-275).
  let streamingUnsupported = false;

  let editCount = 0;
  const streamStartTime = Date.now();

  let currentState: CardState = {
    kind: "message",
    agentName: params.agentName || params.botName,
  };
  let cycleIndex = 0;

  // ─── Helpers ─────────────────────────────────────────────────────────

  function getCyclingTitle(kind: CardKind, customTitle?: string): string {
    const dots = ".".repeat((cycleIndex % 3) + 1);
    if (kind === "tool" && customTitle) return customTitle;
    if (kind === "tool") return `Working${dots}`;
    if (kind === "reasoning") return `Thinking${dots}`;
    if (kind === "waiting") return `Waiting${dots}`;
    return customTitle || "";
  }

  function getAvatar(kind: CardKind): string | undefined {
    if (kind === "tool") return "https://static.neoreef.com/storage/nodes/dev/0/Site%20Documents/computing.gif";
    if (kind === "reasoning") return "https://static.neoreef.com/storage/nodes/dev/0/Site%20Documents/thinking.gif";
    if (kind === "waiting") return "https://static.neoreef.com/storage/nodes/dev/0/Site%20Documents/waiting.gif";
    return undefined;
  }

  function formatReasoningText(detail: string): string {
    const maxWidth = 30;
    const maxLines = 3;

    const rawLines = detail.replace(/\r/g, "").split("\n");
    const wrappedLines: string[] = [];

    for (const line of rawLines) {
      if (line === "") { wrappedLines.push(""); continue; }
      let remaining = line;
      while (remaining.length > maxWidth) {
        let breakIdx = remaining.lastIndexOf(" ", maxWidth);
        if (breakIdx <= 0) breakIdx = maxWidth;
        wrappedLines.push(remaining.substring(0, breakIdx));
        remaining = remaining.substring(breakIdx).trimStart();
      }
      if (remaining.length > 0) wrappedLines.push(remaining);
    }

    let windowLines = wrappedLines.slice(-maxLines);
    while (windowLines.length < maxLines) windowLines.push("");

    const topMarker = wrappedLines.length > maxLines ? "..." : "";
    const invisibleChar = "\u200B";
    const padLine = (text: string) => {
      const t = text.length > maxWidth ? text.substring(0, maxWidth) : text;
      return t + " ".repeat(maxWidth - t.length) + invisibleChar;
    };

    const outLines = [padLine(topMarker), ...windowLines.map(padLine)];
    return "```\n" + outLines.join("\n") + "\n```";
  }

  // ─── Payload Builder ─────────────────────────────────────────────────

  function buildPayload(text: string): Record<string, unknown> {
    const title = getCyclingTitle(currentState.kind, currentState.title);
    const avatar = getAvatar(currentState.kind);
    let agentName = currentState.agentName || params.agentName || params.botName;

    if (currentState.kind === "message") agentName = "";

    const cardTheme = "modern-inline";
    let bodyText = text.trimEnd() || "\u200b";
    let slides: any[] = [];

    const stopButton: CliqButton = {
      label: "Stop",
      hint: "",
      type: "-",
      action: { type: "invoke.function", data: { name: "agentChannelsCallback" } },
      key: "ac:stop",
    };

    let buttons: CliqButton[] | undefined = currentState.buttons;
    if (!buttons && !finalizing) {
      if (currentState.kind !== "message") {
        buttons = [stopButton];
      } else {
        const elapsed = Date.now() - streamStartTime;
        buttons = elapsed > STOP_BUTTON_THRESHOLD_MS ? [stopButton] : undefined;
      }
    }

    if (currentState.kind === "reasoning") {
      bodyText = formatReasoningText(text);
    } else if (currentState.kind === "tool") {
      bodyText = formatReasoningText(text);
      const toolName = currentState.toolName || currentState.title || "Exec";
      const truncatedCmd = text.length > 255 ? text.substring(0, 255) + "..." : text;
      slides = [{ type: "text", title: toolName, data: "```" + truncatedCmd + "```" }];
    }

    const payload: Record<string, unknown> = {
      text: bodyText,
      card: { title: title || undefined, theme: cardTheme, icon: avatar || undefined },
    };

    if (currentState.kind !== "message" && agentName) {
      payload.bot = { name: agentName };
    }
    if (buttons && buttons.length > 0) payload.buttons = buttons;
    if (slides.length > 0) payload.slides = slides;

    return payload;
  }

  // ─── Send / Edit ─────────────────────────────────────────────────────

  function getCurrentChunkContent(fullText: string): string {
    if (fullText.length < finalisedCharCount) return fullText;
    return fullText.substring(finalisedCharCount);
  }

  async function finaliseCurrentChunk(finalText: string): Promise<void> {
    if (currentRef?.chatId && currentRef?.messageId && !editDisabled) {
      const payload = buildPayload(finalText);
      try {
        await editCliqMessage(ctx, currentRef.chatId, currentRef.messageId, payload.text as string, {
          card: payload.card as any,
          slides: payload.slides as any,
          bot: payload.bot as any,
          buttons: payload.buttons as any,
          ...scope,
        });
      } catch (err) {
        ctx.logger.error(`draft-stream finalise edit failed: ${String(err)}`);
      }
      finalisedRefs.push(currentRef);
    }
    finalisedCharCount += finalText.length;
    currentRef = null;
    lastSentText = "";
  }

  async function doSend(text: string): Promise<boolean> {
    try {
      const payload = buildPayload(text);
      const result = await sendCliqCardMessage(ctx, params.botName, params.userId, payload.text as string, payload.card as any, {
        slides: payload.slides as any,
        bot: payload.bot as any,
        buttons: payload.buttons as any,
        chatId: params.chatId,
        ...scope,
      });

      if (result.status >= 400) {
        ctx.logger.error(`draft-stream send failed with status ${result.status}: ${JSON.stringify(result)}`);
        return false;
      }

      didSend = true;

      // The chat send doesn't always echo chat_id (it's in the URL); fall back to
      // the chat we're posting into so the ref is editable (NEO-275).
      const chatId = result.ref.chatId ?? params.chatId;
      if (chatId && result.ref.messageId) {
        currentRef = { chatId, messageId: result.ref.messageId };
        lastSentText = text.trimEnd();
        return true;
      }

      // No editable ref (this send path can't be edited in place). Degrade to
      // "send final once": suppress further per-chunk sends and let the final
      // flush post the complete answer as a single message, instead of spraying
      // each chunk as a fresh message (NEO-275).
      ctx.logger.warn(
        `draft-stream: sent but no editable ref (status ${result.status}, ref=${JSON.stringify(result.ref)}) — degrading to send-final-once`,
      );
      streamingUnsupported = true;
      finalisedCharCount = 0;
      currentRef = null;
      return true;
    } catch (err) {
      ctx.logger.error(`draft-stream send failed: ${String(err)}`);
      return false;
    }
  }

  async function doSendOrEdit(text: string): Promise<boolean> {
    const trimmed = text.trimEnd();
    editCount++;

    // In send-final-once mode we have no editable ref: skip intermediate updates
    // and only emit on the final flush, so the answer lands as one message.
    if (streamingUnsupported && !finalizing) return true;

    try {
      if (currentRef?.chatId && currentRef?.messageId && !editDisabled) {
        const payload = buildPayload(trimmed);
        const result = await editCliqMessage(ctx, currentRef.chatId, currentRef.messageId, payload.text as string, {
          card: payload.card as any,
          slides: payload.slides as any,
          bot: payload.bot as any,
          buttons: payload.buttons as any,
          skipRateLimit: true,
          ...scope,
        });

        if (result.status === 400 || result.status === 403) {
          ctx.logger.error(`draft-stream: edit returned ${result.status}`);
          editDisabled = true;
          return true;
        }
        lastSentText = trimmed;
        return true;
      }

      if (editDisabled) return true;
      return await doSend(text);
    } catch (err) {
      ctx.logger.error(`draft-stream send/edit failed: ${String(err)}`);
      return false;
    }
  }

  async function sendOrEditWithChunking(fullText: string): Promise<boolean> {
    const currentContent = getCurrentChunkContent(fullText);
    if (currentContent.length > CHUNK_LIMIT * 1.2) {
      const { chunkText } = await import("./format.js");
      const chunks = chunkText(currentContent, CHUNK_LIMIT);
      if (chunks.length > 1) {
        await finaliseCurrentChunk(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1;
          if (isLast && chunks[i].length <= CHUNK_LIMIT) {
            return await doSend(chunks[i]);
          } else {
            const sent = await doSend(chunks[i]);
            if (!sent) return false;
            if (i < chunks.length - 1) await finaliseCurrentChunk(chunks[i]);
          }
        }
        return true;
      }
    }
    return await doSendOrEdit(currentContent);
  }

  // ─── Drain Loop ───────────────────────────────────────────────────────

  async function drainLoop(): Promise<void> {
    while (!stopped) {
      if (pendingText === null) {
        await sleep(DRAIN_POLL_MS);
        continue;
      }

      const wait = curveWaitMs();
      if (wait > 0) {
        const waitEnd = Date.now() + wait;
        while (!stopped && Date.now() < waitEnd) {
          await sleep(Math.min(DRAIN_POLL_MS, waitEnd - Date.now()));
        }
      }

      if (stopped) break;

      const text = pendingText;
      if (text === null) continue;
      pendingText = null;
      inFlight = true;

      try {
        await sendOrEditWithChunking(text);
      } catch (err) {
        ctx.logger.error(`draft-stream drain failed: ${String(err)}`);
      } finally {
        inFlight = false;
      }
    }
  }

  // ─── Animation ───────────────────────────────────────────────────────

  function startAnimationTimer() {
    if (!animationTimer && !stopped) {
      animationTimer = setInterval(() => {
        if (stopped) {
          if (animationTimer) clearInterval(animationTimer);
          animationTimer = null;
          return;
        }
        if (currentState.kind === "waiting" || currentState.kind === "reasoning" || currentState.kind === "tool") {
          cycleIndex++;
          if (pendingText === null && !inFlight) {
            pendingText = lastUpdateText;
          }
        }
      }, 2000);
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────

  function update(text: string): void {
    if (stopped) return;
    pendingText = text;
    lastUpdateText = text;
  }

  async function flush(force = false): Promise<void> {
    if (stopped && !force) return;
    if (pendingText !== null) {
      const text = pendingText;
      pendingText = null;
      inFlight = true;
      try {
        let attempts = 0;
        let success = false;
        while (!success && attempts < 3) {
          success = await sendOrEditWithChunking(text);
          if (!success) {
            attempts++;
            if (attempts < 3) await sleep(1000);
          }
        }
      } finally {
        inFlight = false;
      }
    }
  }

  async function setCardState(state: CardState): Promise<void> {
    if (stopped) return;

    const kindChanged = currentState.kind !== state.kind;
    currentState = state;
    cycleIndex++;

    if (kindChanged) {
      lastUpdateText = "";
      pendingText = null;
    }

    const textToRender = pendingText ?? lastUpdateText;
    pendingText = null;
    inFlight = true;
    try {
      let attempts = 0;
      let success = false;
      while (!success && attempts < 3) {
        success = await sendOrEditWithChunking(textToRender);
        if (!success) {
          attempts++;
          if (attempts < 3) await sleep(1000);
        }
      }
    } finally {
      inFlight = false;
    }
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    finalizing = true;
    stopped = true;
    if (animationTimer) { clearInterval(animationTimer); animationTimer = null; }
    await flush(true);
  }

  function cancel(): void {
    if (stopped) return;
    stopped = true;
    pendingText = null;
    if (animationTimer) { clearInterval(animationTimer); animationTimer = null; }

    if (currentState.kind !== "message" && currentRef?.chatId && currentRef?.messageId) {
      deleteCliqMessage(ctx, currentRef.chatId, currentRef.messageId, scope).catch(() => {});
    }
  }

  // Start
  startAnimationTimer();
  void drainLoop();

  return {
    update,
    flush: () => flush(),
    stop,
    cancel,
    messageRef: () => currentRef,
    hasSent: () => didSend,
    getCardState: () => currentState,
    setCardState,
    editsDisabled: () => editDisabled,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
