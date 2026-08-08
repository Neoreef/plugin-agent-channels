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
/**
 * Conversation key — the unit a harness session resumes within. DMs are keyed
 * per (user, agent); group channels per (channel, agent) so the agent keeps one
 * working context for the whole channel rather than one per speaker.
 */
export declare function dmConversationKey(userId: string, agentId: string): string;
export declare function channelConversationKey(channelId: string, agentId: string): string;
/** The harness session to resume for this conversation, or undefined if none/stale. */
export declare function getResumeSession(ctx: PluginContext, convKey: string): Promise<string | undefined>;
/** Persist the session id from a completed turn (prunes stale entries). */
export declare function saveSession(ctx: PluginContext, convKey: string, sessionId: string | undefined): Promise<void>;
//# sourceMappingURL=session-store.d.ts.map