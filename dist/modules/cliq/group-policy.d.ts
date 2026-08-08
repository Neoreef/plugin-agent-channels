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
    guardrails: {
        maxMessagesPerAgentPerHour?: number;
        maxDepth?: number;
    };
    channelGuidance?: string;
};
export declare function readGroupsConfig(ctx: PluginContext): Promise<GroupsConfig>;
export declare function resolveGroupPolicy(cfg: GroupsConfig, channelId: string, channelName?: string): ResolvedGroupPolicy;
//# sourceMappingURL=group-policy.d.ts.map