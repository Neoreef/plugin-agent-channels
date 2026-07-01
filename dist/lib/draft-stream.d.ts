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
import type { CliqMessageRef, CliqButton } from "./cliq-client.js";
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
export declare function createCliqDraftStream(params: DraftStreamParams): CliqDraftStream;
//# sourceMappingURL=draft-stream.d.ts.map