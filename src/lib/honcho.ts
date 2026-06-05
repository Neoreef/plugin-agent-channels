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

/** Separate gate for the per-turn agent-MCP TOOLS path (the slow stdio write
 *  path; superseded by plugin-write #38 + recall-only #40 + hot http #42).
 *  Default OFF so the master flag enables plugin-write WITHOUT the agent-MCP. */
const HONCHO_MCP_TOOLS_FLAG = path.join(
  env("PAPERCLIP_HOME") ?? path.join(os.homedir(), ".paperclip"),
  "honcho-mcp-tools.enabled",
);
export function honchoMcpToolsEnabled(): boolean {
  return existsSync(HONCHO_MCP_TOOLS_FLAG);
}

function honchoBaseUrl(): string { return env("HONCHO_API_URL") ?? "http://127.0.0.1:18820"; }
function honchoMcpRunner(): string { return env("HONCHO_MCP_RUNNER") ?? "/home/brian/projects/honcho/mcp/runner.ts"; }
function honchoMcpTsx(): string {
  return env("HONCHO_MCP_TSX") ?? "/home/brian/projects/paperclip/cli/node_modules/.bin/tsx";
}

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

/** Resolve a Cliq user id → Honcho peer (user_<paperclipId> if mapped, else raw id). */
async function peerForCliqUser(ctx: PluginContext, channelUserId: string): Promise<string> {
  const paperclipUserId = await resolvePaperclipUserFromCliq(ctx, channelUserId).catch(() => null);
  return paperclipUserId ? peerIdForUser(paperclipUserId) : channelUserId;
}

/**
 * Resolve the (workspace, peers, session) ids for a turn.
 *  - DM: session keyed per (user, agent); peers = {user, agent}.
 *  - channel (group present): session keyed per (agent, channel); peers = all
 *    known participants + agent; userPeer = the current speaker.
 * A Cliq user mapped to a Paperclip user → `user_<paperclipId>`, else the raw id.
 */
export async function resolveHonchoScope(
  ctx: PluginContext,
  params: {
    companyId: string;
    agentId: string;
    agentName?: string | null;
    channelUserId: string;
    group?: { channelId: string; participantCliqIds: string[] };
  },
): Promise<HonchoScope> {
  let companyName: string | null = null;
  try {
    companyName = (await ctx.companies.get(params.companyId))?.name ?? null;
  } catch { /* fall back to prefix_companyId */ }

  // Agent display name drives peerIdForAgent; fetch it if the caller didn't supply it.
  let agentName = params.agentName ?? null;
  if (!agentName) {
    try {
      agentName = (await ctx.agents.get(params.agentId, params.companyId) as { name?: string } | null)?.name ?? null;
    } catch { /* peerIdForAgent falls back to agent_<id> */ }
  }

  const workspaceId = workspaceIdForCompany(params.companyId, DEFAULT_WORKSPACE_PREFIX, companyName);
  const agentPeer = peerIdForAgent(params.agentId, agentName);
  const userPeer = await peerForCliqUser(ctx, params.channelUserId);

  if (params.group) {
    // Channel session: one transcript per (agent, channel), shared across speakers.
    const sessionId = `cliq_chan_${hashId(`${agentPeer}|${params.group.channelId}`).slice(0, 16)}`;
    const ids = new Set(params.group.participantCliqIds);
    ids.add(params.channelUserId); // ensure the speaker is included
    const resolved = await Promise.all([...ids].map((id) => peerForCliqUser(ctx, id)));
    const groupPeers = [...new Set(resolved)];
    return { workspaceId, userPeer, agentPeer, sessionId, baseUrl: honchoBaseUrl(), groupPeers };
  }

  // Stable per (user, agent) memory session so the transcript accumulates.
  const sessionId = `cliq_${hashId(`${userPeer}|${agentPeer}`).slice(0, 16)}`;
  return { workspaceId, userPeer, agentPeer, sessionId, baseUrl: honchoBaseUrl() };
}

/**
 * Plugin-side write: record one chat turn to Honcho directly via the v3 API,
 * off the agent loop. Two calls: get-or-create the session with its peers (+
 * observe config), then append the user + assistant messages. Best-effort —
 * the reply is already delivered, so failures are logged, never thrown.
 */
export async function recordHonchoTurn(
  ctx: PluginContext,
  scope: HonchoScope,
  userMessage: string,
  agentReply: string,
): Promise<void> {
  if (!userMessage.trim() || !agentReply.trim()) return;
  const base = `${scope.baseUrl}/v3/workspaces/${encodeURIComponent(scope.workspaceId)}`;
  const postJson = (url: string, body: unknown): Promise<unknown> =>
    ctx.http.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    if (scope.groupPeers && scope.groupPeers.length) {
      // Channel: get-or-create the session, then idempotently add every known
      // participant (handles late joiners) — humans observe; agent observes
      // others. POST /sessions/{id}/peers auto-creates peers.
      const peerMap: Record<string, { observe_me: boolean; observe_others: boolean }> = {
        [scope.agentPeer]: { observe_me: false, observe_others: true },
      };
      for (const p of scope.groupPeers) peerMap[p] = { observe_me: true, observe_others: true };
      await postJson(`${base}/sessions`, { id: scope.sessionId });
      await postJson(`${base}/sessions/${encodeURIComponent(scope.sessionId)}/peers`, peerMap);
      // Attribute the message to the SPEAKER's peer.
      await postJson(`${base}/sessions/${encodeURIComponent(scope.sessionId)}/messages`, {
        messages: [
          { peer_id: scope.userPeer, content: userMessage },
          { peer_id: scope.agentPeer, content: agentReply },
        ],
      });
      ctx.logger.info(`Honcho: recorded channel turn → ${scope.workspaceId}/${scope.sessionId} (${scope.userPeer} → ${scope.agentPeer}, ${scope.groupPeers.length} peers)`);
      return;
    }
    // 1. get-or-create session + peers (idempotent; auto-creates the peers).
    await postJson(`${base}/sessions`, {
      id: scope.sessionId,
      peers: {
        [scope.userPeer]: { observe_me: true, observe_others: true },
        [scope.agentPeer]: { observe_me: false, observe_others: true },
      },
    });
    // 2. record the turn.
    await postJson(`${base}/sessions/${encodeURIComponent(scope.sessionId)}/messages`, {
      messages: [
        { peer_id: scope.userPeer, content: userMessage },
        { peer_id: scope.agentPeer, content: agentReply },
      ],
    });
    ctx.logger.info(`Honcho: recorded turn → ${scope.workspaceId}/${scope.sessionId} (${scope.userPeer} ↔ ${scope.agentPeer})`);
  } catch (e) {
    ctx.logger.info(`Honcho plugin-write failed (non-fatal): ${String(e)}`);
  }
}

// Short in-memory cache of the recall snippet per (workspace, user peer).
const recallCache = new Map<string, { snippet: string; at: number }>();
const RECALL_TTL_MS = 120_000;

function formatRecall(userPeer: string, data: { representation?: unknown; peer_card?: unknown }): string | null {
  const parts: string[] = [];
  const rep = data.representation;
  if (typeof rep === "string" && rep.trim()) {
    const lines = rep.split("\n").filter((l) => l.trim() && !l.startsWith("#")).slice(0, 5)
      .map((l) => l.replace(/^\[.*?\]\s*/, "").replace(/^-\s*/, "").trim());
    const summary = lines.filter(Boolean).join("; ");
    if (summary) parts.push(`Relevant conclusions: ${summary}`);
  }
  const card = data.peer_card;
  if (Array.isArray(card) && card.length) parts.push(`Profile: ${card.join("; ")}`);
  if (!parts.length) return null;
  return `[Honcho memory for this user]: ${parts.join(" | ")}`;
}

/**
 * Plugin-side recall: fetch the user peer's representation (conclusions +
 * profile) from Honcho and return a compact snippet to inject at the SYSTEM
 * level. Off the agent loop, timeboxed + cached, silent on failure. Empty until
 * Honcho's deriver has processed enough turns into conclusions.
 */
export async function honchoRecall(
  ctx: PluginContext,
  scope: HonchoScope,
  prompt: string,
): Promise<string | null> {
  const cacheKey = `${scope.workspaceId}:${scope.userPeer}`;
  const cached = recallCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RECALL_TTL_MS) return cached.snippet || null;
  try {
    const qs = new URLSearchParams({ include_most_frequent: "true", max_conclusions: "15" });
    if (prompt.trim()) { qs.set("search_query", prompt.slice(0, 200)); qs.set("search_top_k", "5"); }
    const url = `${scope.baseUrl}/v3/workspaces/${encodeURIComponent(scope.workspaceId)}/peers/${encodeURIComponent(scope.userPeer)}/context?${qs.toString()}`;
    const res = (await Promise.race([
      ctx.http.fetch(url, { method: "GET" }),
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ])) as { text?: () => Promise<string> } | null;
    if (!res || typeof res.text !== "function") return cached?.snippet || null;
    const data = JSON.parse(await res.text()) as { representation?: unknown; peer_card?: unknown };
    const snippet = formatRecall(scope.userPeer, data);
    recallCache.set(cacheKey, { snippet: snippet ?? "", at: Date.now() });
    return snippet;
  } catch (e) {
    ctx.logger.info(`Honcho recall failed (non-fatal): ${String(e)}`);
    return cached?.snippet || null;
  }
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
