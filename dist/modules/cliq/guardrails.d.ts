/**
 * Flywheel guardrails for multi-agent channels.
 *
 * When several agent bots share a channel, each bot's reply is itself a channel
 * message that the other bots receive — without limits they ping-pong forever.
 * Two brakes (ported from the OpenClaw Cliq plugin):
 *   - message DEPTH: a human message is depth 0; a bot replying to depth-N is
 *     depth N+1; replies past `maxDepth` are dropped.
 *   - hourly per-agent-per-channel CAP on messages sent.
 */
export type GuardrailConfig = {
    maxMessagesPerAgentPerHour?: number;
    maxDepth?: number;
};
/** True if a sender is another bot (vs a human) — drives depth + flywheel. */
export declare function isBotSender(senderId: string | undefined, relay?: boolean): boolean;
/** Human messages = depth 0; a bot reply increments from the parent depth. */
export declare function resolveMessageDepth(params: {
    senderIsBotMessage: boolean;
    parentDepth?: number;
}): number;
/** Whether an agent may send in a channel right now. */
export declare function checkGuardrails(params: {
    agentId: string;
    channelId: string;
    depth?: number;
    config: GuardrailConfig;
}): {
    allowed: true;
} | {
    allowed: false;
    reason: string;
};
/** Record that an agent sent a message in a channel (call after delivery). */
export declare function recordAgentMessage(agentId: string, channelId: string): void;
//# sourceMappingURL=guardrails.d.ts.map