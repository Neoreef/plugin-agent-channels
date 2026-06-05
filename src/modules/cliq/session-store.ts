/**
 * Per-(user, agent) chat session store.
 *
 * Persists the harness session id returned by each turn so the next message
 * from the same Cliq user to the same agent RESUMES that session (hermes ACP
 * session/load, claude/gemini --resume) — giving multi-turn memory. Keying by
 * (userId, agentId) also isolates conversations per user: each person gets a
 * distinct harness session, so turn history does not bleed across users.
 *
 * Note: this gives per-user *session* isolation. Per-user dialectic *peer*
 * modeling in Honcho (a separate user model per person) additionally requires
 * the harness to receive the user id (hermes gateway mode) — see AC-13.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";

const STATE_KEY = "cliq.chatSessions";
/** Resume only within this inactivity window; older threads start fresh. */
const TTL_MS = 6 * 60 * 60_000; // 6 hours

type SessionEntry = { sessionId: string; updatedAt: number };
type SessionMap = Record<string, SessionEntry>;

/**
 * Conversation key — the unit a harness session resumes within. DMs are keyed
 * per (user, agent); group channels per (channel, agent) so the agent keeps one
 * working context for the whole channel rather than one per speaker.
 */
export function dmConversationKey(userId: string, agentId: string): string {
  return `${userId}:${agentId}`;
}
export function channelConversationKey(channelId: string, agentId: string): string {
  return `chan:${channelId}:${agentId}`;
}

async function readAll(ctx: PluginContext): Promise<SessionMap> {
  const all = (await ctx.state.get({ scopeKind: "instance", stateKey: STATE_KEY })) as SessionMap | null;
  return all ?? {};
}

/** The harness session to resume for this conversation, or undefined if none/stale. */
export async function getResumeSession(
  ctx: PluginContext,
  convKey: string,
): Promise<string | undefined> {
  const entry = (await readAll(ctx))[convKey];
  if (!entry) return undefined;
  if (Date.now() - entry.updatedAt > TTL_MS) return undefined;
  return entry.sessionId;
}

/** Persist the session id from a completed turn (prunes stale entries). */
export async function saveSession(
  ctx: PluginContext,
  convKey: string,
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) return;
  const all = await readAll(ctx);
  all[convKey] = { sessionId, updatedAt: Date.now() };
  const cutoff = Date.now() - TTL_MS;
  for (const k of Object.keys(all)) {
    if (all[k].updatedAt < cutoff) delete all[k];
  }
  await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEY }, all);
}
