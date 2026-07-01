/**
 * Per-channel roster for multi-agent group channels.
 *
 * Tracks, per Cliq channel (keyed by chatId):
 *   - human participants observed in inbound webhooks (id/name/email, LRU) —
 *     these become Honcho `user_*` peers in the shared channel session and
 *     populate the "who's in the room" context block.
 *   - agent bots seen posting in the channel — the multi-agent team roster,
 *     rendered for prompt injection so each agent knows who else is present.
 *
 * In-memory only (rebuilt from webhooks after a worker restart). Adapted from
 * the OpenClaw Cliq plugin's roster.ts.
 */
export type CliqParticipant = {
    id: string;
    name?: string;
    email?: string;
    lastSeen: number;
};
export type ChannelBot = {
    botUniqueName: string;
    agentId: string;
    displayName?: string;
};
/** Note a human participant observed in a channel message (non-bot senders). */
export declare function noteHumanParticipant(channelId: string, sender: {
    id?: string;
    name?: string;
    email?: string;
}): void;
/** All known human participants in a channel, most-recently-seen first. */
export declare function getChannelParticipants(channelId: string): CliqParticipant[];
/** Record that an agent bot is active in a channel (discovered from webhooks). */
export declare function recordChannelBot(channelId: string, bot: ChannelBot): void;
/** Agent bots known to be in a channel. */
export declare function getChannelBots(channelId: string): ChannelBot[];
/**
 * A "who's in the room" block for prompt injection: human participants plus the
 * agent team. `selfBotName` is omitted from the agent list (the agent is the
 * "you", not a teammate). Returns undefined when nothing is known yet.
 */
export declare function renderRoster(channelId: string, channelLabel: string, selfBotName?: string): string | undefined;
//# sourceMappingURL=roster.d.ts.map