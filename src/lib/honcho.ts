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

import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { workspaceIdForCompany, peerIdForAgent, peerIdForUser, hashId } from "./honcho-ids.js";
import { resolvePaperclipUserFromCliq } from "../modules/notifications/service-notify.js";

const DEFAULT_WORKSPACE_PREFIX = "paperclip"; // mirrors paperclip-honcho DEFAULT_WORKSPACE_PREFIX

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/** Flag-file toggle (the plugin worker runs with a stripped env, so an env flag
 *  wouldn't reach it; a file the worker can stat does). Default OFF. Create the
 *  file to enable: `touch ~/.paperclip/honcho-mcp.enabled`.
 *  TODO: replace with a proper per-instance/per-agent config toggle in the UI. */
const HONCHO_FLAG_FILE = path.join(
  env("PAPERCLIP_HOME") ?? path.join(os.homedir(), ".paperclip"),
  "honcho-mcp.enabled",
);
export function honchoEnabled(): boolean {
  if (process.env.HONCHO_MCP_ENABLED === "0" || process.env.HONCHO_MCP_ENABLED === "false") return false;
  return existsSync(HONCHO_FLAG_FILE);
}

function honchoBaseUrl(): string { return env("HONCHO_API_URL") ?? "http://127.0.0.1:18820"; }
function honchoMcpRunner(): string { return env("HONCHO_MCP_RUNNER") ?? "/home/brian/projects/honcho/mcp/runner.ts"; }
function honchoMcpTsx(): string {
  return env("HONCHO_MCP_TSX") ?? "/home/brian/projects/paperclip/cli/node_modules/.bin/tsx";
}

export interface HonchoScope {
  workspaceId: string;
  userPeer: string;
  agentPeer: string;
  sessionId: string;
  baseUrl: string;
}

/**
 * Resolve the (workspace, user peer, agent peer, session) ids for a turn.
 * IsLocal? a Cliq user mapped to a Paperclip user → `user_<paperclipId>`,
 * otherwise the raw channel user id (per the design diagram).
 */
export async function resolveHonchoScope(
  ctx: PluginContext,
  params: { companyId: string; agentId: string; agentName?: string | null; channelUserId: string },
): Promise<HonchoScope> {
  let companyName: string | null = null;
  try {
    companyName = (await ctx.companies.get(params.companyId))?.name ?? null;
  } catch { /* fall back to prefix_companyId */ }

  const workspaceId = workspaceIdForCompany(params.companyId, DEFAULT_WORKSPACE_PREFIX, companyName);
  const agentPeer = peerIdForAgent(params.agentId, params.agentName ?? null);

  const paperclipUserId = await resolvePaperclipUserFromCliq(ctx, params.channelUserId).catch(() => null);
  const userPeer = paperclipUserId ? peerIdForUser(paperclipUserId) : params.channelUserId;

  // Stable per (user, agent) memory session so the transcript accumulates.
  const sessionId = `cliq_${hashId(`${userPeer}|${agentPeer}`).slice(0, 16)}`;

  return { workspaceId, userPeer, agentPeer, sessionId, baseUrl: honchoBaseUrl() };
}

/** The `mcpServers` object that points a harness at the scoped Honcho MCP. */
export function honchoMcpServers(scope: HonchoScope): Record<string, unknown> {
  return {
    honcho: {
      command: honchoMcpTsx(),
      args: [honchoMcpRunner(), "--stdio"],
      env: {
        HONCHO_API_URL: scope.baseUrl,
        HONCHO_API_KEY: "local",
        HONCHO_WORKSPACE_ID: scope.workspaceId,
        HONCHO_USER_NAME: scope.userPeer,
        HONCHO_ASSISTANT_NAME: scope.agentPeer,
      },
    },
  };
}

/** Write a per-turn MCP config file (for claude `--mcp-config <path>`); returns the path. */
export function writeHonchoMcpConfig(scope: HonchoScope): string {
  const safe = scope.sessionId.replace(/[^a-zA-Z0-9_-]+/g, "");
  const file = path.join(os.tmpdir(), `honcho-mcp-${safe}.json`);
  writeFileSync(file, JSON.stringify({ mcpServers: honchoMcpServers(scope) }), "utf8");
  return file;
}

/** Parameterized usage instructions injected into the turn so the agent uses memory. */
export function honchoInstructions(scope: HonchoScope): string {
  return [
    "## Memory (Honcho)",
    "You have Honcho memory tools (the workspace is already scoped — never pass a workspace).",
    "For THIS conversation use exactly these ids:",
    `- session_id: ${scope.sessionId}`,
    `- your assistant peer_id: ${scope.agentPeer}`,
    `- the user's peer_id: ${scope.userPeer}`,
    "",
    "At the start of the turn, ensure the session + peers exist (idempotent):",
    `create_session(session_id) · create_peer(${scope.userPeer}) · create_peer(${scope.agentPeer}) ·`,
    `add_peers_to_session(session_id, [{peer_id:${scope.userPeer}, observe_me:true, observe_others:true}, {peer_id:${scope.agentPeer}, observe_me:false, observe_others:true}]).`,
    "When personalization helps, call `chat(peer_id=<assistant>, target_peer_id=<user>, session_id, query=...)` to recall about the user BEFORE answering.",
    "After answering, record the turn with `add_messages_to_session(session_id, [{peer_id:<user>, content:<their message>}, {peer_id:<assistant>, content:<your reply>}])`.",
    "Keep this bookkeeping silent — do not mention Honcho to the user.",
  ].join("\n");
}
