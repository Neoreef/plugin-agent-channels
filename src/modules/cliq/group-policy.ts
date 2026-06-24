/**
 * Group-channel policy resolution.
 *
 * Reads the per-instance `cliq.groups` config (set via plugin settings) and
 * resolves, for a given channel, whether agents may respond, whether an
 * @mention is required, the flywheel guardrail caps, and any channel-specific
 * guidance injected into the prompt.
 *
 * Config shape (ctx.state instance `cliq.groups`):
 *   {
 *     policy: "open" | "allowlist" | "disabled",   // default "open"
 *     channels: {
 *       "<channelId or unique_name or '*'>": {
 *         allow?: boolean,                 // for allowlist policy
 *         requireMention?: boolean,        // default true (opt into broadcast/flywheel with false)
 *         maxMessagesPerAgentPerHour?: number,
 *         maxDepth?: number,
 *         channelGuidance?: string,
 *       }
 *     }
 *   }
 *
 * Defaults are conservative: respond in any channel the bot is in, but only when
 * @mentioned. Set a channel's `requireMention: false` to enable the multi-agent
 * broadcast flywheel (every message triggers agents, bounded by guardrails).
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";

export type GroupEntry = {
  allow?: boolean;
  requireMention?: boolean;
  maxMessagesPerAgentPerHour?: number;
  maxDepth?: number;
  channelGuidance?: string;
};

export type GroupsConfig = {
  policy?: "open" | "allowlist" | "disabled";
  channels?: Record<string, GroupEntry>;
};

export type ResolvedGroupPolicy = {
  enabled: boolean;
  requireMention: boolean;
  guardrails: { maxMessagesPerAgentPerHour?: number; maxDepth?: number };
  channelGuidance?: string;
};

const STATE_KEY = "cliq.groups";

export async function readGroupsConfig(ctx: PluginContext): Promise<GroupsConfig> {
  const cfg = (await ctx.state.get({ scopeKind: "instance", stateKey: STATE_KEY })) as GroupsConfig | null;
  return cfg ?? {};
}

/** Persist the `cliq.groups` instance config (written from plugin settings). */
export async function saveGroupsConfig(ctx: PluginContext, cfg: GroupsConfig): Promise<void> {
  await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEY }, cfg);
}

/** Pick the most specific config entry for a channel (by id, then name, then "*"). */
function entryFor(cfg: GroupsConfig, channelId: string, channelName?: string): GroupEntry | undefined {
  const channels = cfg.channels ?? {};
  return channels[channelId] ?? (channelName ? channels[channelName] : undefined) ?? channels["*"];
}

export function resolveGroupPolicy(
  cfg: GroupsConfig,
  channelId: string,
  channelName?: string,
): ResolvedGroupPolicy {
  const policy = cfg.policy ?? "open";
  const entry = entryFor(cfg, channelId, channelName);

  let enabled: boolean;
  if (policy === "disabled") enabled = false;
  else if (policy === "allowlist") enabled = entry?.allow === true;
  else enabled = entry?.allow !== false; // "open": on unless explicitly disallowed

  return {
    enabled,
    requireMention: entry?.requireMention ?? true,
    guardrails: {
      maxMessagesPerAgentPerHour: entry?.maxMessagesPerAgentPerHour,
      maxDepth: entry?.maxDepth,
    },
    channelGuidance: entry?.channelGuidance,
  };
}
