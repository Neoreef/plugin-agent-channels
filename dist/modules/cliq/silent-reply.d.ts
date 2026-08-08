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
export declare const SILENT_REPLY_TOKEN = "<SILENT>";
/** Per-turn guidance injected for broadcast (always-on) channels. */
export declare function broadcastSelfSelectGuidance(): string;
/**
 * True when an agent's reply is just the silent token (so we suppress delivery).
 * Tolerant of a model that wraps the token in whitespace, quotes, code fences,
 * or drops the angle brackets — but strict enough that real messages pass
 * through: only a reply that reduces to the bare token counts as silent.
 */
export declare function isSilentReply(text: string | undefined): boolean;
//# sourceMappingURL=silent-reply.d.ts.map