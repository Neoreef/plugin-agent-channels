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

/** Max human participants tracked per channel (LRU by lastSeen). */
const MAX_PARTICIPANTS_PER_CHANNEL = 100;

/** channelId → Map<participantId, CliqParticipant> */
const channelParticipants = new Map<string, Map<string, CliqParticipant>>();
/** channelId → Map<botUniqueName, ChannelBot> */
const channelBots = new Map<string, Map<string, ChannelBot>>();

// ─── Human participants ──────────────────────────────────────────────────────

/** Note a human participant observed in a channel message (non-bot senders). */
export function noteHumanParticipant(
  channelId: string,
  sender: { id?: string; name?: string; email?: string },
): void {
  const key = sender.id || sender.email;
  if (!key) return;
  let participants = channelParticipants.get(channelId);
  if (!participants) {
    participants = new Map();
    channelParticipants.set(channelId, participants);
  }
  participants.set(key, { id: key, name: sender.name, email: sender.email, lastSeen: Date.now() });
  if (participants.size > MAX_PARTICIPANTS_PER_CHANNEL) {
    const sorted = [...participants.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    for (const [k] of sorted.slice(0, participants.size - MAX_PARTICIPANTS_PER_CHANNEL)) {
      participants.delete(k);
    }
  }
}

/** All known human participants in a channel, most-recently-seen first. */
export function getChannelParticipants(channelId: string): CliqParticipant[] {
  const participants = channelParticipants.get(channelId);
  if (!participants) return [];
  return [...participants.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

// ─── Agent bots (multi-agent team) ───────────────────────────────────────────

/** Record that an agent bot is active in a channel (discovered from webhooks). */
export function recordChannelBot(channelId: string, bot: ChannelBot): void {
  let bots = channelBots.get(channelId);
  if (!bots) {
    bots = new Map();
    channelBots.set(channelId, bots);
  }
  bots.set(bot.botUniqueName, bot);
}

/** Agent bots known to be in a channel. */
export function getChannelBots(channelId: string): ChannelBot[] {
  return [...(channelBots.get(channelId)?.values() ?? [])];
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/**
 * A "who's in the room" block for prompt injection: human participants plus the
 * agent team. `selfBotName` is omitted from the agent list (the agent is the
 * "you", not a teammate). Returns undefined when nothing is known yet.
 */
export function renderRoster(
  channelId: string,
  channelLabel: string,
  selfBotName?: string,
): string | undefined {
  const humans = getChannelParticipants(channelId);
  const bots = getChannelBots(channelId).filter((b) => b.botUniqueName !== selfBotName);
  if (humans.length === 0 && bots.length === 0) return undefined;
  const lines: string[] = [];
  for (const h of humans) lines.push(`- ${h.name ?? h.id}${h.email ? ` (${h.email})` : ""}`);
  for (const b of bots) lines.push(`- ${b.displayName ?? b.botUniqueName} (agent)`);
  return `Participants in ${channelLabel}:\n${lines.join("\n")}`;
}
