/**
 * Zoho Cliq API client for Paperclip plugin context.
 * Handles OAuth token refresh, bot message sending, card messages,
 * streaming edits, and rate limiting.
 *
 * Supports per-service auth (bridge.service.{serviceId}.auth/config)
 * with fallback to global zoho.auth for legacy.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { DATA_CENTERS, type DataCenterKey } from "../constants.js";
import type { ZohoAuthState } from "./types.js";
import { acquireSlot, recordLockout, recordSlotUsage } from "./rate-limiter.js";
import { markdownToCliq } from "./format.js";

const TOKEN_SAFETY_MARGIN_MS = 60_000;

// Per-service refresh state to prevent a thundering herd of concurrent refreshes.
// Many streaming edits can race to refresh an expired token at once; we collapse
// them into a single in-flight refresh per service, and back off per service if
// Zoho rate-limits us. Keying by serviceId keeps concurrent multi-service
// refreshes independent — one service's refresh (or rate-limit backoff) can't
// clobber another's in a multi-tenant deployment.
const refreshInFlight = new Map<string, Promise<string>>();
const refreshBackoffUntil = new Map<string, number>();

// The legacy global-auth path has no serviceId; bucket those calls together.
const GLOBAL_REFRESH_KEY = "__global__";

// ─── Per-service auth ────────────────────────────────────────────────────────

type ServiceOAuthConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  dataCenter: DataCenterKey;
};

async function getServiceAuth(ctx: PluginContext, serviceId: string): Promise<ZohoAuthState | null> {
  return (await ctx.state.get({ scopeKind: "instance", stateKey: `bridge.service.${serviceId}.auth` })) as ZohoAuthState | null;
}

async function getServiceConfig(ctx: PluginContext, serviceId: string): Promise<ServiceOAuthConfig | null> {
  return (await ctx.state.get({ scopeKind: "instance", stateKey: `bridge.service.${serviceId}.config` })) as ServiceOAuthConfig | null;
}

async function saveServiceAuth(ctx: PluginContext, serviceId: string, auth: ZohoAuthState): Promise<void> {
  await ctx.state.set({ scopeKind: "instance", stateKey: `bridge.service.${serviceId}.auth` }, auth);
}

// ─── Resolve auth: try per-service first, then global fallback ───────────────

async function resolveAuth(ctx: PluginContext, serviceId?: string): Promise<{ auth: ZohoAuthState; serviceId?: string }> {
  // Try per-service
  if (serviceId) {
    const auth = await getServiceAuth(ctx, serviceId);
    if (auth?.refreshToken) return { auth, serviceId };
  }
  // Find first connected Cliq service
  const services = ((await ctx.state.get({ scopeKind: "instance", stateKey: "channels.services" })) as any[] | null) ?? [];
  for (const svc of services) {
    if (svc.type === "zoho-cliq") {
      const auth = await getServiceAuth(ctx, svc.id);
      if (auth?.refreshToken) return { auth, serviceId: svc.id };
    }
  }
  // Legacy global fallback
  const global = (await ctx.state.get({ scopeKind: "instance", stateKey: "zoho.auth" })) as ZohoAuthState | null;
  if (global?.refreshToken) return { auth: global };
  throw new Error("Zoho not connected. Complete OAuth setup in plugin settings.");
}

async function refreshAccessToken(ctx: PluginContext, serviceId?: string): Promise<string> {
  const key = serviceId ?? GLOBAL_REFRESH_KEY;

  // Collapse concurrent refreshes for this service into one in-flight request.
  const inFlight = refreshInFlight.get(key);
  if (inFlight) return inFlight;

  // Respect Zoho rate-limit backoff (tracked per service).
  if (Date.now() < (refreshBackoffUntil.get(key) ?? 0)) {
    // Return the (possibly stale) cached token rather than hammering Zoho.
    const { auth } = await resolveAuth(ctx, serviceId);
    if (auth.accessToken) return auth.accessToken;
    throw new Error("Token refresh backing off after Zoho rate limit");
  }

  const refresh = doRefreshAccessToken(ctx, serviceId)
    .catch((err) => {
      // On "too many requests", back off this service for 10 minutes.
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

async function doRefreshAccessToken(ctx: PluginContext, serviceId?: string): Promise<string> {
  const { auth, serviceId: resolvedServiceId } = await resolveAuth(ctx, serviceId);

  // Get credentials from per-service config or plugin config
  let clientId: string | undefined;
  let clientSecret: string | undefined;

  if (resolvedServiceId) {
    const svcConfig = await getServiceConfig(ctx, resolvedServiceId);
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
    await saveServiceAuth(ctx, resolvedServiceId, updated);
  } else {
    await ctx.state.set({ scopeKind: "instance", stateKey: "zoho.auth" }, updated);
  }
  return data.access_token;
}

async function getAccessToken(ctx: PluginContext, serviceId?: string): Promise<{ token: string; dataCenter: DataCenterKey }> {
  const { auth } = await resolveAuth(ctx, serviceId);
  if (auth.accessToken && auth.expiresAt && Date.now() < auth.expiresAt) {
    return { token: auth.accessToken, dataCenter: auth.dataCenter };
  }
  const token = await refreshAccessToken(ctx, serviceId);
  const refreshed = await resolveAuth(ctx, serviceId);
  return { token, dataCenter: refreshed.auth.dataCenter };
}

// ─── Core fetch with rate limiting + 401/429 handling ────────────────────────

async function cliqFetch(
  ctx: PluginContext,
  method: string,
  url: string,
  body: unknown | undefined,
  opts?: { maxWaitMs?: number; skipRateLimit?: boolean; serviceId?: string },
): Promise<{ status: number; data: unknown }> {
  if (opts?.skipRateLimit) {
    recordSlotUsage();
  } else {
    const acquired = await acquireSlot(opts?.maxWaitMs ?? 0);
    if (!acquired) {
      return { status: 0, data: { skipped: true, reason: "rate-limit-timeout" } };
    }
  }

  const { token, dataCenter } = await getAccessToken(ctx, opts?.serviceId);
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
    const newToken = await refreshAccessToken(ctx, opts?.serviceId);
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
export async function downloadCliqFile(ctx: PluginContext, url: string): Promise<Buffer | null> {
  try {
    const { token } = await getAccessToken(ctx);
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
): Promise<{ ref: CliqMessageRef }> {
  const body: Record<string, unknown> = {
    text: markdownToCliq(text),
    userids: userId,
    sync_message: true,
  };
  if (buttons && buttons.length > 0) body.buttons = buttons;

  const result = await cliqFetch(ctx, "POST", `/bots/${encodeURIComponent(botName)}/message`, body);
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
  },
): Promise<{ status: number; ref: CliqMessageRef }> {
  const body: Record<string, unknown> = {
    text,
    userids: userId,
    card,
    sync_message: true,
  };
  if (opts?.slides && opts.slides.length > 0) body.slides = opts.slides;
  if (opts?.bot) body.bot = opts.bot;
  if (opts?.buttons && opts.buttons.length > 0) body.buttons = opts.buttons;

  const result = await cliqFetch(ctx, "POST", `/bots/${encodeURIComponent(botName)}/message`, body);
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
  opts?: { buttons?: CliqButton[] },
): Promise<{ status: number; ref: CliqMessageRef }> {
  const body: Record<string, unknown> = { text: markdownToCliq(text), sync_message: true };
  if (opts?.buttons && opts.buttons.length > 0) body.buttons = opts.buttons;

  const result = await cliqFetch(ctx, "POST", `/chats/${encodeURIComponent(chatId)}/message`, body);
  const messageId = extractBotDmMessageRef(result.data, "").messageId;
  return { status: result.status, ref: { chatId, messageId } };
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
    { skipRateLimit: opts?.skipRateLimit },
  );
}

// ─── Delete message ──────────────────────────────────────────────────────────

export async function deleteCliqMessage(
  ctx: PluginContext,
  chatId: string,
  messageId: string,
): Promise<void> {
  await cliqFetch(
    ctx,
    "DELETE",
    `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    undefined,
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
export async function listCliqUsers(ctx: PluginContext, serviceId?: string): Promise<CliqUser[]> {
  const out: CliqUser[] = [];
  const seen = new Set<string>();
  let nextToken: string | undefined;
  // Cap pages so a misbehaving cursor can't loop forever (100/page × 20 = 2000).
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ fields: "display_name", limit: "100" });
    if (nextToken) params.set("next_token", nextToken);
    const { status, data } = await cliqFetch(ctx, "GET", `/users?${params.toString()}`, undefined, {
      serviceId,
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
): Promise<void> {
  const { chunkText } = await import("./format.js");
  const chunks = chunkText(text);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await sendCliqMessage(ctx, botName, userId, chunks[i], isLast ? buttons : undefined);
  }
}

// ─── Proactive token refresh (per-service) ───────────────────────────────────

export async function proactiveServiceTokenRefresh(ctx: PluginContext, serviceId: string): Promise<void> {
  try {
    const auth = await getServiceAuth(ctx, serviceId);
    if (!auth?.refreshToken) return;
    const timeUntilExpiry = auth.expiresAt - Date.now();
    if (timeUntilExpiry < 15 * 60_000) {
      await refreshAccessToken(ctx, serviceId);
    }
  } catch {
    // No auth configured — skip
  }
}

/** @deprecated Use proactiveServiceTokenRefresh */
export async function proactiveTokenRefresh(ctx: PluginContext): Promise<void> {
  try {
    const { auth } = await resolveAuth(ctx);
    const timeUntilExpiry = auth.expiresAt - Date.now();
    if (timeUntilExpiry < 15 * 60_000) {
      await refreshAccessToken(ctx);
    }
  } catch {
    // No auth configured — skip
  }
}
