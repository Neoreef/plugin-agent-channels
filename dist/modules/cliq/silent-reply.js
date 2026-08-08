/**
 * Broadcast self-selection (NEO-209).
 *
 * In a broadcast channel (`requireMention: false`) every agent sees every
 * message, so without a brake every agent would reply to everything. Mirroring
 * the old OpenClaw `monitor.ts` chat-room UX: inject a per-turn instruction
 * telling each agent to emit a single silent token when it has nothing valuable
 * to add, then suppress any reply that is just that token so non-participating
 * agents stay quiet. @mentions are how you directly address one agent; otherwise
 * each agent self-selects whether to speak.
 */
export const SILENT_REPLY_TOKEN = "<SILENT>";
/** Per-turn guidance injected for broadcast (always-on) channels. */
export function broadcastSelfSelectGuidance() {
    return [
        "You are one of several agents in this channel; every message is broadcast to all of you.",
        "Be a good group participant: mostly lurk and follow along. Reply only when you are directly addressed (by @mention or by name) or you can add clear, specific value.",
        `If a reply isn't needed from you, respond with exactly "${SILENT_REPLY_TOKEN}" and nothing else — no other words, punctuation, tags, markdown, or code blocks.`,
        `Short affirmations like "yes", "ok", "sure", "go ahead" are almost always meant for whoever asked the last question; if that wasn't you, stay silent with ${SILENT_REPLY_TOKEN}.`,
    ].join(" ");
}
/**
 * True when an agent's reply is just the silent token (so we suppress delivery).
 * Tolerant of a model that wraps the token in whitespace, quotes, code fences,
 * or drops the angle brackets — but strict enough that real messages pass
 * through: only a reply that reduces to the bare token counts as silent.
 */
export function isSilentReply(text) {
    if (!text)
        return false;
    const stripped = text
        .trim()
        .replace(/^```[a-z]*\s*|\s*```$/gi, "") // surrounding code fence
        .trim();
    if (stripped === SILENT_REPLY_TOKEN)
        return true;
    // Reduce to bare alphanumerics so "<SILENT>", "[SILENT]", "*silent*",
    // "SILENT", "NO_REPLY" all collapse to the same comparable core.
    const core = stripped.replace(/[^a-z0-9]/gi, "").toUpperCase();
    return core === "SILENT" || core === "NOREPLY";
}
//# sourceMappingURL=silent-reply.js.map