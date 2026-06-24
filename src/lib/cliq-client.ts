/**
 * Zoho Cliq API client for Paperclip plugin context.
 * Handles OAuth token refresh, bot message sending, card messages,
 * streaming edits, and rate limiting.
 *
 * Per-company, per-service auth (NEO-79): a `CliqScope` of `{ companyId?,
 * serviceId? }` flows through the send/refresh paths so a company's bot always
 * uses that company's own Zoho org. Storage lives in `service-store.ts` under
 * `scopeKind: "company"`, with legacy `instance`/global fallback when no
 * companyId is supplied.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { DATA_CENTERS, type DataCenterKey } from "../constants.js";
import type { ZohoAuthState } from "./types.js";
import {
  getServiceAuth,
  getServiceOAuthConfig,
  saveServiceAuth,
  findConnectedService,
} from "./service-store.js";
import { acquireSlot, recordLockout, recordSlotUsage } from "./rate-limiter.js";
import { markdownToCliq } from "./format.js";

const TOKEN_SAFETY_MARGIN_MS = 60_000;

/** Identifies which company/service a Cliq call should authenticate as. */
export type CliqScope = { companyId?: string; serviceId?: string };

// Per-(company,service) refresh state to prevent a thundering herd of concurrent
// refreshes. Many streaming edits can race to refresh an expired token at once;
// we collapse them into a single in-flight refresh per scope, and back off per
// scope if Zoho rate-limits us. Keying by company+service keeps concurrent
// multi-tenant refreshes independent — one company's refresh (or rate-limit
// backoff) can't clobber another's.
const refreshInFlight = new Map<string, Promise<string>>();
const refreshBackoffUntil = new Map<string, number>();

// The legacy global-auth path has no companyId/serviceId; bucket those together.
const GLOBAL_REFRESH_KEY = "__global__";

function refreshKey(scope: CliqScope): string {
  if (!scope.companyId && !scope.serviceId) return GLOBAL_REFRESH_KEY;
  return `${scope.companyId ?? "_"}::${scope.serviceId ?? "_"}`;
}

// ─── Resolve auth: per-service → company's first connected → global fallback ──

async function resolveAuth(
  ctx: PluginContext,
  scope: CliqScope,
): Promise<{ auth: ZohoAuthState; serviceId?: string; companyId?: string }> {
  const { companyId, serviceId } = scope;
  // Try the explicit service first.
  if (serviceId) {
    const auth = await getServiceAuth(ctx, serviceId, companyId);
    if (auth?.refreshToken) return { auth, serviceId, companyId };
  }
  // Find the company's first connected Cliq service.
  const found = await findConnectedService(ctx, "zoho-cliq", companyId);
  if (found) return { auth: found.auth, serviceId: found.serviceId, companyId };
  // Legacy global fallback (only when not scoped to a company, to keep tenants
  // isolated — a company never inherits the unscoped global token).
  if (!companyId) {
    const global = (await ctx.state.get({ scopeKind: "instance", stateKey: "zoho.auth" })) as ZohoAuthState | null;
    if (global?.refreshToken) return { auth: global };
  }
  throw new Error("Zoho not connected. Complete OAuth setup in plugin settings.");
}

async function refreshAccessToken(ctx: PluginContext, scope: CliqScope): Promise<string> {
  const key = refreshKey(scope);

  // Collapse concurrent refreshes for this scope into one in-flight request.
  const inFlight = refreshInFlight.get(key);
  if (inFlight) return inFlight;

  // Respect Zoho rate-limit backoff (tracked per scope).
  if (Date.now() < (refreshBackoffUntil.get(key) ?? 0)) {
    // Return the (possibly stale) cached token rather than hammering Zoho.
    const { auth } = await resolveAuth(ctx, scope);
    if (auth.accessToken) return auth.accessToken;
    throw new Error("Token refresh backing off after Zoho rate limit");
  }

  const refresh = doRefreshAccessToken(ctx, scope)
    .catch((err) => {
      // On "too many requests", back off this scope for 10 minutes.
      if (String(err).includes("too many requests") || String(err).includes("Access Denied")) {
        refreshBackoffUntil.set(key, Date.now() + 10 * 60_000);
        ctx.logger.error("Zoho refresh rate-limited — backing off 10 min");
      }
      throw err;
    })
    .finally(() => {
      refreshInFlight.delete(key);
    });
  refreshInFlight.set(key, refresh);
  return refresh;
}

async function doRefreshAccessToken(ctx: PluginContext, scope: CliqScope): Promise<string> {
  const { auth, serviceId: resolvedServiceId, companyId: resolvedCompanyId } = await resolveAuth(ctx, scope);

  // Get credentials from per-service config or plugin config
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  if (resolvedServiceId) {
    const svcConfig = await getServiceOAuthConfig(ctx, resolvedServiceId, resolvedCompanyId);
    clientId = svcConfig?.clientId;
    clientSecret = svcConfig?.clientSecret;
  }

  if (!clientId || !clientSecret) {
    // Fallback to plugin-level config
    const config = (await ctx.config.get()) as { zohoClientId?: string; zohoClientSecret?: string };
    clientId = clientId || config.zohoClientId;
    clientSecret = clientSecret || config.zohoClientSecret;
  }

  if (!clientId || !clientSecret) {
    throw new Error("Missing OAuth credentials. Configure in service settings.");
  }

  const center = DATA_CENTERS[auth.dataCenter] ?? DATA_CENTERS.US;
  const params = new URLSearchParams({
    refresh_token: auth.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const res = await ctx.http.fetch(`https://${center.accounts}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoho token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Zoho token refresh returned no access_token");

  const updated: ZohoAuthState = {
    ...auth,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - TOKEN_SAFETY_MARGIN_MS,
  };

  if (resolvedServiceId) {
    await saveServiceAuth(ctx, resolvedServiceId, updated, resolvedCompanyId);
  } else {
    await ctx.state.set({ scopeKind: "instance", stateKey: "zoho.auth" }, updated);
  }
  return data.access_token;
}

async function getAccessToken(ctx: PluginContext, scope: CliqScope): Promise<{ token: string; dataCenter: DataCenterKey }> {
  const { auth } = await resolveAuth(ctx, scope);
  if (auth.accessToken && auth.expiresAt && Date.now() < auth.expiresAt) {
    return { token: auth.accessToken, dataCenter: auth.dataCenter };
  }
  const token = await refreshAccessToken(ctx, scope);
  const refreshed = await resolveAuth(ctx, scope);
  return { token, dataCenter: refreshed.auth.dataCenter };
}

// ─── Core fetch with rate limiting + 401/429 handling ────────────────────────

async function cliqFetch(
  ctx: PluginContext,
  method: string,
  url: string,
  body: unknown | undefined,
  opts?: { maxWaitMs?: number; skipRateLimit?: boolean; serviceId?: string; companyId?: string },
): Promise<{ status: number; data: unknown }> {
  if (opts?.skipRateLimit) {
    recordSlotUsage();
  } else {
    const acquired = await acquireSlot(opts?.maxWaitMs ?? 0);
    if (!acquired) {
      return { status: 0, data: { skipped: true, reason: "rate-limit-timeout" } };
    }
  }

  const scope: CliqScope = { companyId: opts?.companyId, serviceId: opts?.serviceId };
  const { token, dataCenter } = await getAccessToken(ctx, scope);
  const center = DATA_CENTERS[dataCenter] ?? DATA_CENTERS.US;
  const fullUrl = url.startsWith("https://") ? url : `https://${center.cliq}/api/v2${url}`;

  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${token}`,
    "Content-Type": "application/json",
  };

  // Cliq returns 204 No Content for successful edits/deletes. The host's worker
  // RPC bridge builds `new Response(body, { status })`, which throws for a
  // no-content status (204/205/304) carrying a body. Treat that as a successful
  // empty response instead of letting it surface as an error.
  const NO_CONTENT_RE = /invalid response status code\s*(204|205|304)/i;
  const httpFetch = async (init: RequestInit): Promise<Response> => {
    try {
      return await ctx.http.fetch(fullUrl, init);
    } catch (e) {
      const m = String((e as Error)?.message ?? e).match(NO_CONTENT_RE);
      if (m) return { status: Number(m[1]), headers: new Headers(), text: async () => "" } as Response;
      throw e;
    }
  };
  const init: RequestInit = {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  };

  let res = await httpFetch(init);

  if (res.status === 429) {
    recordLockout(10 * 60_000);
    return { status: 429, data: await safeJson(res) };
  }

  if (res.status === 401) {
    const newToken = await refreshAccessToken(ctx, scope);
    headers.Authorization = `Zoho-oauthtoken ${newToken}`;
    res = await httpFetch({ ...init, headers });
    if (res.status === 429) recordLockout(10 * 60_000);
  }

  return { status: res.status, data: await safeJson(res) };
}

async function safeJson(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  return await res.text();
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type CliqButton = {
  label: string;
  key: string;
  type: "+" | "-";
  hint?: string;
  action: { type: "invoke.function"; data: { name: string } };
};

export type CliqMessageRef = {
  chatId?: string;
  messageId?: string;
};

// ─── Edit-capability probe cache (per chat, 24h) ─────────────────────────────
// Some users/grants can't edit bot messages (edit → 401/403). We learn this
// per chat from the first edit attempt and degrade to plain sends thereafter,
// rather than leaving a placeholder stuck. (Pattern from ~/.claude-agent.)

const editCapabilityCache = new Map<string, { capable: boolean; at: number }>();
const EDIT_CAP_TTL_MS = 24 * 60 * 60 * 1000;

export function getChatEditCapability(chatId: string): boolean | undefined {
  const c = editCapabilityCache.get(chatId);
  if (!c) return undefined;
  if (Date.now() - c.at > EDIT_CAP_TTL_MS) { editCapabilityCache.delete(chatId); return undefined; }
  return c.capable;
}

export function setChatEditCapability(chatId: string, capable: boolean): void {
  editCapabilityCache.set(chatId, { capable, at: Date.now() });
}

// ─── Message Ref Extraction ──────────────────────────────────────────────────

/**
 * Cliq returns composite ids URL-encoded in JSON (e.g. message_id
 * "1780350234100%2045183446516" — a `<time> <seq>` pair). Decode here so the
 * edit endpoint can re-encode it correctly; otherwise encodeURIComponent turns
 * the "%" into "%25" and the edit URL 404s.
 */
function decodeId(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  try { return decodeURIComponent(v); } catch { return v; }
}

function extractBotDmMessageRef(data: unknown, userId: string): CliqMessageRef {
  const root = ((data as any)?.data ?? data) as any;
  const md = root?.message_details;
  // Prefer the entry for this user; fall back to the first entry (DM replies
  // have a single recipient and Cliq sometimes keys it differently than the
  // id we sent). Then try a top-level message object as a last resort.
  let details: any;
  if (md && typeof md === "object") {
    details = md[userId] ?? Object.values(md)[0];
  }
  details = details ?? root?.message ?? root;
  return {
    chatId: decodeId(details?.chat_id ?? details?.chatId ?? root?.chat_id),
    messageId: decodeId(details?.message_id ?? details?.messageId ?? root?.message_id ?? root?.id),
  };
}

// ─── Download an inbound file attachment ─────────────────────────────────────

/**
 * Download a Cliq file attachment by its `url` (NOT the hash id — only the url
 * works), authenticated with the OAuth token (needs ZohoCliq.Attachments.READ).
 * Returns the raw bytes, or null on failure.
 */
export async function downloadCliqFile(ctx: PluginContext, url: string, scope: CliqScope = {}): Promise<Buffer | null> {
  try {
    const { token } = await getAccessToken(ctx, scope);
    const res = await ctx.http.fetch(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const status = (res as { status?: number }).status ?? 200;
    if (status >= 400) {
      ctx.logger.info(`Cliq file download ${status} for ${url.slice(0, 80)}`);
      return null;
    }
    const ab = await (res as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
    return Buffer.from(ab);
  } catch (e) {
    ctx.logger.info(`Cliq file download failed: ${String(e)}`);
    return null;
  }
}

// ─── Send plain text message ─────────────────────────────────────────────────

export async function sendCliqMessage(
  ctx: PluginContext,
  botName: string,
  userId: string,
  text: string,
  buttons?: CliqButton[],
  scope: CliqScope = {},
): Promise<{ ref: CliqMessageRef }> {
  const body: Record<string, unknown> = {
    text: markdownToCliq(text),
    userids: userId,
    sync_message: true,
  };
  if (buttons && buttons.length > 0) body.buttons = buttons;

  const result = await cliqFetch(ctx, "POST", `/bots/${encodeURIComponent(botName)}/message`, body, scope);
  if (!result.status || result.status >= 400) {
    ctx.logger.error(`Cliq send failed (${result.status}): ${JSON.stringify(result.data).slice(0, 200)}`);
  }

  return { ref: extractBotDmMessageRef(result.data, userId) };
}

// ─── Send card message ───────────────────────────────────────────────────────

export async function sendCliqCardMessage(
  ctx: PluginContext,
  botName: string,
  userId: string,
  text: string,
  card: { theme: string; title?: string; icon?: string },
  opts?: {
    slides?: Array<{ type: string; title?: string; data: any }>;
    bot?: { name: string; image?: string };
    buttons?: CliqButton[];
    companyId?: string;
    serviceId?: string;
    chatId?: string;
  },
): Promise<{ status: number; ref: CliqMessageRef }> {
  const body: Record<string, unknown> = {
    text,
    card,
    sync_message: true,
  };
  if (opts?.slides && opts.slides.length > 0) body.slides = opts.slides;
  if (opts?.bot) body.bot = opts.bot;
  if (opts?.buttons && opts.buttons.length > 0) body.buttons = opts.buttons;

  let url: string;
  if (opts?.chatId) {
    url = `/chats/${encodeURIComponent(opts.chatId)}/message`;
  } else {
    url = `/bots/${encodeURIComponent(botName)}/message`;
    body.userids = userId;
  }

  const result = await cliqFetch(ctx, "POST", url, body, {
    companyId: opts?.companyId,
    serviceId: opts?.serviceId,
  });
  return { status: result.status, ref: extractBotDmMessageRef(result.data, userId) };
}

// ─── Send into a chat (editable: same endpoint family as edit) ───────────────

/**
 * Post a message into a chat by id (the chat the user DMed the bot in, from the
 * webhook's chat.id). Unlike /bots/{bot}/message, a message posted here can be
 * edited via PUT /chats/{id}/messages/{messageId} (both use Webhooks scopes).
 */
export async function sendCliqChatMessage(
  ctx: PluginContext,
  chatId: string,
  text: string,
  opts?: { buttons?: CliqButton[]; companyId?: string; serviceId?: string; bot?: { name: string; image?: string } },
): Promise<{ status: number; ref: CliqMessageRef }> {
  const body: Record<string, unknown> = { text: markdownToCliq(text), sync_message: true };
  if (opts?.buttons && opts.buttons.length > 0) body.buttons = opts.buttons;
  // Attribute the message to the posting bot. Posting to /chats/{id}/message via
  // the shared company connection otherwise renders every agent's reply with the
  // same anonymous integration identity — in a multi-bot channel you can't tell
  // who answered. The `bot` persona field sets the displayed name/avatar.
  if (opts?.bot?.name) body.bot = opts.bot;

  const result = await cliqFetch(ctx, "POST", `/chats/${encodeURIComponent(chatId)}/message`, body, {
    companyId: opts?.companyId,
    serviceId: opts?.serviceId,
  });
  const messageId = extractBotDmMessageRef(result.data, "").messageId;
  return { status: result.status, ref: { chatId, messageId } };
}

/**
 * One-shot diagnostic (NEO-206): resolve a channel from its chat id and log its
 * real `unique_name` plus its member/bot list, so we can see exactly which bot
 * unique_names Zoho considers channel members (the `/channelsbyname?bot_unique_name`
 * send 400s with `bot_not_member` and we need to know the correct identifier).
 */
export async function logCliqChannelDiagnostics(
  ctx: PluginContext,
  chatId: string,
  scope: { companyId?: string; serviceId?: string } = {},
): Promise<void> {
  try {
    const chRes = await cliqFetch(ctx, "GET", `/channels?chat_ids=${encodeURIComponent(chatId)}`, undefined, scope);
    const root = (chRes.data ?? {}) as Record<string, unknown>;
    const list = (Array.isArray(root.channels) ? root.channels : Array.isArray(chRes.data) ? (chRes.data as unknown[]) : []) as Array<Record<string, unknown>>;
    const ch = list[0] ?? root;
    const channelId = (ch?.channel_id ?? ch?.id) as string | undefined;
    ctx.logger.info(
      `Cliq diag channel: chat=${chatId} status=${chRes.status} channel_id=${channelId ?? "-"} ` +
      `unique_name=${(ch?.unique_name as string) ?? "-"} name=${(ch?.name as string) ?? "-"} ` +
      `raw=${JSON.stringify(chRes.data).slice(0, 300)}`,
    );
    if (channelId) {
      const mRes = await cliqFetch(ctx, "GET", `/channels/${encodeURIComponent(channelId)}/members`, undefined, scope);
      ctx.logger.info(`Cliq diag members: status=${mRes.status} raw=${JSON.stringify(mRes.data).slice(0, 600)}`);
    }
  } catch (e) {
    ctx.logger.info(`Cliq diag failed for chat ${chatId}: ${String(e)}`);
  }
}

/**
 * Post into a channel **as a specific bot**, by channel unique name. Unlike
 * `/chats/{chatId}/message` (which renders every reply with the same anonymous
 * shared-connection sender), `/channelsbyname/{name}/message?bot_unique_name=…`
 * attributes the message to the bot's real registered identity (name + avatar)
 * — so participants can tell which agent answered (NEO-206). Mirrors the old
 * OpenClaw plugin's channel send.
 */
export async function sendCliqChannelMessage(
  ctx: PluginContext,
  channelName: string,
  botName: string,
  text: string,
  opts?: { buttons?: CliqButton[]; companyId?: string; serviceId?: string },
): Promise<{ status: number; ref: CliqMessageRef }> {
  const body: Record<string, unknown> = { text: markdownToCliq(text), sync_message: true };
  if (opts?.buttons && opts.buttons.length > 0) body.buttons = opts.buttons;

  const path = `/channelsbyname/${encodeURIComponent(channelName)}/message?bot_unique_name=${encodeURIComponent(botName)}`;
  const result = await cliqFetch(ctx, "POST", path, body, {
    companyId: opts?.companyId,
    serviceId: opts?.serviceId,
  });
  if (!result.status || result.status >= 400) {
    ctx.logger.error(`Cliq channel send failed (${result.status}) for #${channelName}: ${JSON.stringify(result.data).slice(0, 200)}`);
  }
  const messageId = (result.data as { message_id?: string } | undefined)?.message_id;
  return { status: result.status, ref: { messageId } };
}

// ─── Edit message ────────────────────────────────────────────────────────────

export async function editCliqMessage(
  ctx: PluginContext,
  chatId: string,
  messageId: string,
  text: string,
  opts?: {
    card?: { theme: string; title?: string; icon?: string };
    slides?: Array<{ type: string; title?: string; data: any }>;
    bot?: { name: string; image?: string };
    buttons?: CliqButton[];
    skipRateLimit?: boolean;
    companyId?: string;
    serviceId?: string;
  },
): Promise<{ status: number; data: unknown }> {
  const formattedText = opts?.card ? text : markdownToCliq(text);
  const body: Record<string, unknown> = { text: formattedText };
  if (opts?.card) body.card = opts.card;
  if (opts?.slides) body.slides = opts.slides;
  if (opts?.bot) body.bot = opts.bot;
  if (opts?.buttons) body.buttons = opts.buttons;

  return cliqFetch(
    ctx,
    "PUT",
    `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    body,
    { skipRateLimit: opts?.skipRateLimit, companyId: opts?.companyId, serviceId: opts?.serviceId },
  );
}

// ─── Delete message ──────────────────────────────────────────────────────────

export async function deleteCliqMessage(
  ctx: PluginContext,
  chatId: string,
  messageId: string,
  scope: CliqScope = {},
): Promise<void> {
  await cliqFetch(
    ctx,
    "DELETE",
    `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    undefined,
    scope,
  );
}

// ─── List org users (for the notification user picker) ───────────────────────

export type CliqUser = { id: string; name: string; email?: string };

/** Map one raw Cliq /users row to a CliqUser, or null if it has no id. */
function toCliqUser(u: Record<string, unknown>): CliqUser | null {
  const id = u.id ?? u.user_id ?? u.zuid ?? u.zoid;
  if (id == null) return null;
  const first = typeof u.first_name === "string" ? u.first_name : "";
  const last = typeof u.last_name === "string" ? u.last_name : "";
  // Cliq returns `display_name` (only when requested via ?fields=display_name)
  // and `email_id`; fall back to first/last, then email, then the raw id.
  const email =
    (typeof u.email_id === "string" && u.email_id) ||
    (typeof u.email === "string" && u.email) ||
    "";
  const name =
    (typeof u.display_name === "string" && u.display_name) ||
    (typeof u.name === "string" && u.name) ||
    [first, last].filter(Boolean).join(" ") ||
    email ||
    String(id);
  const user: CliqUser = { id: String(id), name };
  if (email) user.email = email;
  return user;
}

/**
 * Best-effort list of Zoho Cliq org users (id → display name/email), for the
 * notify-mapping UI. Requests `display_name` explicitly (Cliq omits it
 * otherwise) and paginates via `next_token`. Returns [] on error/empty.
 * Requires the ZohoCliq.Users.READ / ZohoCliq.Organisation.READ scope — a
 * connection consented before those were added returns 401/"not authorised".
 */
export async function listCliqUsers(ctx: PluginContext, scope: CliqScope = {}): Promise<CliqUser[]> {
  const out: CliqUser[] = [];
  const seen = new Set<string>();
  let nextToken: string | undefined;
  // Cap pages so a misbehaving cursor can't loop forever (100/page × 20 = 2000).
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ fields: "display_name", limit: "100" });
    if (nextToken) params.set("next_token", nextToken);
    const { status, data } = await cliqFetch(ctx, "GET", `/users?${params.toString()}`, undefined, {
      companyId: scope.companyId,
      serviceId: scope.serviceId,
    });
    if (status < 200 || status >= 300) {
      ctx.logger.info(`listCliqUsers: HTTP ${status}${page > 0 ? ` (after ${out.length} users)` : ""}`);
      break;
    }
    const root = (data ?? {}) as Record<string, unknown>;
    const rows =
      (Array.isArray(root.users) && root.users) ||
      (Array.isArray(root.data) && root.data) ||
      (Array.isArray(data) ? (data as unknown[]) : []);
    for (const r of rows as Array<Record<string, unknown>>) {
      const user = toCliqUser(r);
      if (user && !seen.has(user.id)) {
        seen.add(user.id);
        out.push(user);
      }
    }
    const tok = root.next_token ?? root.sync_token;
    const hasMore = root.has_more === true || (typeof tok === "string" && tok.length > 0);
    if (!hasMore || typeof tok !== "string" || !tok) break;
    nextToken = tok;
  }
  return out;
}

// ─── Chunked send ────────────────────────────────────────────────────────────

export async function sendCliqMessageChunked(
  ctx: PluginContext,
  botName: string,
  userId: string,
  text: string,
  buttons?: CliqButton[],
  scope: CliqScope = {},
): Promise<void> {
  const { chunkText } = await import("./format.js");
  const chunks = chunkText(text);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await sendCliqMessage(ctx, botName, userId, chunks[i], isLast ? buttons : undefined, scope);
  }
}

// ─── Proactive token refresh (per-company, per-service) ──────────────────────

export async function proactiveServiceTokenRefresh(
  ctx: PluginContext,
  serviceId: string,
  companyId?: string,
): Promise<void> {
  try {
    const auth = await getServiceAuth(ctx, serviceId, companyId);
    if (!auth?.refreshToken) return;
    const timeUntilExpiry = auth.expiresAt - Date.now();
    if (timeUntilExpiry < 15 * 60_000) {
      await refreshAccessToken(ctx, { companyId, serviceId });
    }
  } catch {
    // No auth configured — skip
  }
}

/** @deprecated Use proactiveServiceTokenRefresh */
export async function proactiveTokenRefresh(ctx: PluginContext): Promise<void> {
  try {
    const { auth } = await resolveAuth(ctx, {});
    const timeUntilExpiry = auth.expiresAt - Date.now();
    if (timeUntilExpiry < 15 * 60_000) {
      await refreshAccessToken(ctx, {});
    }
  } catch {
    // No auth configured — skip
  }
}
