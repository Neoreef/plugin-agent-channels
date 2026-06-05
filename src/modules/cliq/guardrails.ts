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
  maxMessagesPerAgentPerHour?: number; // default 30
  maxDepth?: number; // default 3
};

type HourlyCounter = { count: number; windowStart: number };

const hourlyCounts = new Map<string, HourlyCounter>(); // agentId:channelId → counter
const HOUR_MS = 60 * 60 * 1000;

/** True if a sender is another bot (vs a human) — drives depth + flywheel. */
export function isBotSender(senderId: string | undefined, relay?: boolean): boolean {
  return relay === true || (typeof senderId === "string" && senderId.startsWith("bot:"));
}

/** Human messages = depth 0; a bot reply increments from the parent depth. */
export function resolveMessageDepth(params: {
  senderIsBotMessage: boolean;
  parentDepth?: number;
}): number {
  if (!params.senderIsBotMessage) return 0;
  return (params.parentDepth ?? 0) + 1;
}

/** Whether an agent may send in a channel right now. */
export function checkGuardrails(params: {
  agentId: string;
  channelId: string;
  depth?: number;
  config: GuardrailConfig;
}): { allowed: true } | { allowed: false; reason: string } {
  const maxPerHour = params.config.maxMessagesPerAgentPerHour ?? 30;
  const maxDepth = params.config.maxDepth ?? 3;

  if (params.depth !== undefined && params.depth > maxDepth) {
    return { allowed: false, reason: `depth ${params.depth} exceeds maxDepth ${maxDepth}` };
  }

  const key = `${params.agentId}:${params.channelId}`;
  const now = Date.now();
  let counter = hourlyCounts.get(key);
  if (!counter || now - counter.windowStart > HOUR_MS) {
    counter = { count: 0, windowStart: now };
    hourlyCounts.set(key, counter);
  }
  if (counter.count >= maxPerHour) {
    return { allowed: false, reason: `hourly cap reached (${counter.count}/${maxPerHour})` };
  }
  return { allowed: true };
}

/** Record that an agent sent a message in a channel (call after delivery). */
export function recordAgentMessage(agentId: string, channelId: string): void {
  const key = `${agentId}:${channelId}`;
  const now = Date.now();
  let counter = hourlyCounts.get(key);
  if (!counter || now - counter.windowStart > HOUR_MS) {
    counter = { count: 0, windowStart: now };
    hourlyCounts.set(key, counter);
  }
  counter.count++;
}
