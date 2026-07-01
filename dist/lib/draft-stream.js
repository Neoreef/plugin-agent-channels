/**
 * Cliq draft stream — streaming card message with edit-in-place.
 *
 * Manages a single Cliq message that transitions between card states
 * (waiting → reasoning → tool → message) via a drain loop gated by
 * the rate limiter's slot availability.
 *
 * Adapted from ~/.claude-agent/src/draft-stream.ts to use plugin context.
 */
import { sendCliqCardMessage, editCliqMessage, deleteCliqMessage } from "./cliq-client.js";
import { curveWaitMs } from "./rate-limiter.js";
const CHUNK_LIMIT = 3500;
const DRAIN_POLL_MS = 50;
const STOP_BUTTON_THRESHOLD_MS = 5000;
// ─── Factory ─────────────────────────────────────────────────────────────────
export function createCliqDraftStream(params) {
    const { ctx } = params;
    let currentRef = params.initialRef ?? null;
    let didSend = !!params.initialRef?.chatId;
    let stopped = false;
    let pendingText = null;
    let lastUpdateText = "";
    let animationTimer = null;
    let inFlight = false;
    let finalisedCharCount = 0;
    let lastSentText = "";
    const finalisedRefs = [];
    let editDisabled = false;
    let finalizing = false;
    let editCount = 0;
    const streamStartTime = Date.now();
    let currentState = {
        kind: "message",
        agentName: params.agentName || params.botName,
    };
    let cycleIndex = 0;
    // ─── Helpers ─────────────────────────────────────────────────────────
    function getCyclingTitle(kind, customTitle) {
        const dots = ".".repeat((cycleIndex % 3) + 1);
        if (kind === "tool" && customTitle)
            return customTitle;
        if (kind === "tool")
            return `Working${dots}`;
        if (kind === "reasoning")
            return `Thinking${dots}`;
        if (kind === "waiting")
            return `Waiting${dots}`;
        return customTitle || "";
    }
    function getAvatar(kind) {
        if (kind === "tool")
            return "https://static.neoreef.com/storage/nodes/dev/0/Site%20Documents/computing.gif";
        if (kind === "reasoning")
            return "https://static.neoreef.com/storage/nodes/dev/0/Site%20Documents/thinking.gif";
        if (kind === "waiting")
            return "https://static.neoreef.com/storage/nodes/dev/0/Site%20Documents/waiting.gif";
        return undefined;
    }
    function formatReasoningText(detail) {
        const maxWidth = 30;
        const maxLines = 3;
        const rawLines = detail.replace(/\r/g, "").split("\n");
        const wrappedLines = [];
        for (const line of rawLines) {
            if (line === "") {
                wrappedLines.push("");
                continue;
            }
            let remaining = line;
            while (remaining.length > maxWidth) {
                let breakIdx = remaining.lastIndexOf(" ", maxWidth);
                if (breakIdx <= 0)
                    breakIdx = maxWidth;
                wrappedLines.push(remaining.substring(0, breakIdx));
                remaining = remaining.substring(breakIdx).trimStart();
            }
            if (remaining.length > 0)
                wrappedLines.push(remaining);
        }
        let windowLines = wrappedLines.slice(-maxLines);
        while (windowLines.length < maxLines)
            windowLines.push("");
        const topMarker = wrappedLines.length > maxLines ? "..." : "";
        const invisibleChar = "\u200B";
        const padLine = (text) => {
            const t = text.length > maxWidth ? text.substring(0, maxWidth) : text;
            return t + " ".repeat(maxWidth - t.length) + invisibleChar;
        };
        const outLines = [padLine(topMarker), ...windowLines.map(padLine)];
        return "```\n" + outLines.join("\n") + "\n```";
    }
    // ─── Payload Builder ─────────────────────────────────────────────────
    function buildPayload(text) {
        const title = getCyclingTitle(currentState.kind, currentState.title);
        const avatar = getAvatar(currentState.kind);
        let agentName = currentState.agentName || params.agentName || params.botName;
        if (currentState.kind === "message")
            agentName = "";
        const cardTheme = "modern-inline";
        let bodyText = text.trimEnd() || "\u200b";
        let slides = [];
        const stopButton = {
            label: "Stop",
            hint: "",
            type: "-",
            action: { type: "invoke.function", data: { name: "agentChannelsCallback" } },
            key: "ac:stop",
        };
        let buttons = currentState.buttons;
        if (!buttons && !finalizing) {
            if (currentState.kind !== "message") {
                buttons = [stopButton];
            }
            else {
                const elapsed = Date.now() - streamStartTime;
                buttons = elapsed > STOP_BUTTON_THRESHOLD_MS ? [stopButton] : undefined;
            }
        }
        if (currentState.kind === "reasoning") {
            bodyText = formatReasoningText(text);
        }
        else if (currentState.kind === "tool") {
            bodyText = formatReasoningText(text);
            const toolName = currentState.toolName || currentState.title || "Exec";
            const truncatedCmd = text.length > 255 ? text.substring(0, 255) + "..." : text;
            slides = [{ type: "text", title: toolName, data: "```" + truncatedCmd + "```" }];
        }
        const payload = {
            text: bodyText,
            card: { title: title || undefined, theme: cardTheme, icon: avatar || undefined },
        };
        if (currentState.kind !== "message" && agentName) {
            payload.bot = { name: agentName };
        }
        if (buttons && buttons.length > 0)
            payload.buttons = buttons;
        if (slides.length > 0)
            payload.slides = slides;
        return payload;
    }
    // ─── Send / Edit ─────────────────────────────────────────────────────
    function getCurrentChunkContent(fullText) {
        if (fullText.length < finalisedCharCount)
            return fullText;
        return fullText.substring(finalisedCharCount);
    }
    async function finaliseCurrentChunk(finalText) {
        if (currentRef?.chatId && currentRef?.messageId && !editDisabled) {
            const payload = buildPayload(finalText);
            try {
                await editCliqMessage(ctx, currentRef.chatId, currentRef.messageId, payload.text, {
                    card: payload.card,
                    slides: payload.slides,
                    bot: payload.bot,
                    buttons: payload.buttons,
                });
            }
            catch (err) {
                ctx.logger.error(`draft-stream finalise edit failed: ${String(err)}`);
            }
            finalisedRefs.push(currentRef);
        }
        finalisedCharCount += finalText.length;
        currentRef = null;
        lastSentText = "";
    }
    async function doSend(text) {
        try {
            const payload = buildPayload(text);
            const result = await sendCliqCardMessage(ctx, params.botName, params.userId, payload.text, payload.card, {
                slides: payload.slides,
                bot: payload.bot,
                buttons: payload.buttons,
            });
            didSend = true;
            if (result.ref.chatId && result.ref.messageId) {
                currentRef = result.ref;
                lastSentText = text.trimEnd();
                return true;
            }
            ctx.logger.error("draft-stream: sent but no ref returned");
            finalisedCharCount += text.length;
            currentRef = null;
            return true;
        }
        catch (err) {
            ctx.logger.error(`draft-stream send failed: ${String(err)}`);
            return false;
        }
    }
    async function doSendOrEdit(text) {
        const trimmed = text.trimEnd();
        editCount++;
        try {
            if (currentRef?.chatId && currentRef?.messageId && !editDisabled) {
                const payload = buildPayload(trimmed);
                const result = await editCliqMessage(ctx, currentRef.chatId, currentRef.messageId, payload.text, {
                    card: payload.card,
                    slides: payload.slides,
                    bot: payload.bot,
                    buttons: payload.buttons,
                    skipRateLimit: true,
                });
                if (result.status === 400 || result.status === 403) {
                    ctx.logger.error(`draft-stream: edit returned ${result.status}`);
                    editDisabled = true;
                    return true;
                }
                lastSentText = trimmed;
                return true;
            }
            if (editDisabled)
                return true;
            return await doSend(text);
        }
        catch (err) {
            ctx.logger.error(`draft-stream send/edit failed: ${String(err)}`);
            return false;
        }
    }
    async function sendOrEditWithChunking(fullText) {
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
                    }
                    else {
                        const sent = await doSend(chunks[i]);
                        if (!sent)
                            return false;
                        if (i < chunks.length - 1)
                            await finaliseCurrentChunk(chunks[i]);
                    }
                }
                return true;
            }
        }
        return await doSendOrEdit(currentContent);
    }
    // ─── Drain Loop ───────────────────────────────────────────────────────
    async function drainLoop() {
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
            if (stopped)
                break;
            const text = pendingText;
            if (text === null)
                continue;
            pendingText = null;
            inFlight = true;
            try {
                await sendOrEditWithChunking(text);
            }
            catch (err) {
                ctx.logger.error(`draft-stream drain failed: ${String(err)}`);
            }
            finally {
                inFlight = false;
            }
        }
    }
    // ─── Animation ───────────────────────────────────────────────────────
    function startAnimationTimer() {
        if (!animationTimer && !stopped) {
            animationTimer = setInterval(() => {
                if (stopped) {
                    if (animationTimer)
                        clearInterval(animationTimer);
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
    function update(text) {
        if (stopped)
            return;
        pendingText = text;
        lastUpdateText = text;
    }
    async function flush(force = false) {
        if (stopped && !force)
            return;
        if (pendingText !== null) {
            const text = pendingText;
            pendingText = null;
            inFlight = true;
            try {
                await sendOrEditWithChunking(text);
            }
            finally {
                inFlight = false;
            }
        }
    }
    async function setCardState(state) {
        if (stopped)
            return;
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
            await sendOrEditWithChunking(textToRender);
        }
        finally {
            inFlight = false;
        }
    }
    async function stop() {
        if (stopped)
            return;
        finalizing = true;
        stopped = true;
        if (animationTimer) {
            clearInterval(animationTimer);
            animationTimer = null;
        }
        await flush(true);
    }
    function cancel() {
        if (stopped)
            return;
        stopped = true;
        pendingText = null;
        if (animationTimer) {
            clearInterval(animationTimer);
            animationTimer = null;
        }
        if (currentState.kind !== "message" && currentRef?.chatId && currentRef?.messageId) {
            deleteCliqMessage(ctx, currentRef.chatId, currentRef.messageId).catch(() => { });
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
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=draft-stream.js.map