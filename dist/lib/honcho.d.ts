/**
 * Honcho memory wiring for chat turns.
 *
 * Each turn, the agent is given the self-hosted Honcho MCP server (see
 * honcho/mcp/runner.ts) scoped to the company workspace + the resolved
 * user/agent peers, so it can recall-then-write per-user memory. Ids mirror the
 * Paperclip Honcho plugin (honcho-ids.ts) so chat + issue memory unify.
 *
 * Gated behind HONCHO_MCP_ENABLED so it's opt-in until proven on each harness.
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
export declare function honchoEnabled(): boolean;
export declare function honchoMcpToolsEnabled(): boolean;
export interface HonchoScope {
    workspaceId: string;
    /** The CURRENT speaker's peer (the user in a DM; the speaking participant in a channel). */
    userPeer: string;
    agentPeer: string;
    sessionId: string;
    baseUrl: string;
    /** Present for channel/group turns: every known participant peer for the
     *  shared channel session (humans observe_me+others; agent observe_others). */
    groupPeers?: string[];
}
/**
 * Resolve the (workspace, peers, session) ids for a turn.
 *  - DM: session keyed per (user, agent); peers = {user, agent}.
 *  - channel (group present): session keyed per (agent, channel); peers = all
 *    known participants + agent; userPeer = the current speaker.
 * A Cliq user mapped to a Paperclip user → `user_<paperclipId>`, else the raw id.
 */
export declare function resolveHonchoScope(ctx: PluginContext, params: {
    companyId: string;
    agentId: string;
    agentName?: string | null;
    channelUserId: string;
    group?: {
        channelId: string;
        participantCliqIds: string[];
    };
}): Promise<HonchoScope>;
/**
 * Plugin-side write: record one chat turn to Honcho directly via the v3 API,
 * off the agent loop. Two calls: get-or-create the session with its peers (+
 * observe config), then append the user + assistant messages. Best-effort —
 * the reply is already delivered, so failures are logged, never thrown.
 */
export declare function recordHonchoTurn(ctx: PluginContext, scope: HonchoScope, userMessage: string, agentReply: string): Promise<void>;
/**
 * Plugin-side recall: fetch the user peer's representation (conclusions +
 * profile) from Honcho and return a compact snippet to inject at the SYSTEM
 * level. Off the agent loop, timeboxed + cached, silent on failure. Empty until
 * Honcho's deriver has processed enough turns into conclusions.
 */
export declare function honchoRecall(ctx: PluginContext, scope: HonchoScope, prompt: string): Promise<string | null>;
/** The `mcpServers` object that points a harness at the scoped Honcho MCP. */
export declare function honchoMcpServers(scope: HonchoScope): Record<string, unknown>;
/** Write a per-turn MCP config file (for claude `--mcp-config <path>`); returns the path. */
export declare function writeHonchoMcpConfig(scope: HonchoScope): string;
/** Parameterized usage instructions injected into the turn so the agent uses memory. */
export declare function honchoInstructions(scope: HonchoScope): string;
//# sourceMappingURL=honcho.d.ts.map