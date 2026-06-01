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

// Shared refresh state to prevent a thundering herd of concurrent refreshes.
// Many streaming edits can race to refresh an expired token at once; we collapse
// them into a single in-flight refresh, and back off if Zoho rate-limits us.
let refreshInFlight: Promise<string> | null = null;
let refreshBackoffUntil = 0;

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
  // Collapse concurrent refreshes into one in-flight request.
  if (refreshInFlight) return refreshInFlight;

  // Respect Zoho rate-limit backoff.
  if (Date.now() < refreshBackoffUntil) {
    // Return the (possibly stale) cached token rather than hammering Zoho.
    const { auth } = await resolveAuth(ctx, serviceId);
    if (auth.accessToken) return auth.accessToken;
    throw new Error("Token refresh backing off after Zoho rate limit");
  }

  refreshInFlight = doRefreshAccessToken(ctx, serviceId)
    .catch((err) => {
      // On "too many requests", back off for 10 minutes.
      if (String(err).includes("too many requests") || String(err).includes("Access Denied")) {
        refreshBackoffUntil = Date.now() + 10 * 60_000;
        ctx.logger.error("Zoho refresh rate-limited — backing off 10 min");
      }
      throw err;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
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
  opts?: { maxWaitMs?: number; skipRateLimit?: boolean },
): Promise<{ status: number; data: unknown }> {
  if (opts?.skipRateLimit) {
    recordSlotUsage();
  } else {
    const acquired = await acquireSlot(opts?.maxWaitMs ?? 0);
    if (!acquired) {
      return { status: 0, data: { skipped: true, reason: "rate-limit-timeout" } };
    }
  }

  const { token, dataCenter } = await getAccessToken(ctx);
  const center = DATA_CENTERS[dataCenter] ?? DATA_CENTERS.US;
  const fullUrl = url.startsWith("https://") ? url : `https://${center.cliq}/api/v2${url}`;

  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${token}`,
    "Content-Type": "application/json",
  };

  let res = await ctx.http.fetch(fullUrl, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429) {
    recordLockout(10 * 60_000);
    return { status: 429, data: await safeJson(res) };
  }

  if (res.status === 401) {
    const newToken = await refreshAccessToken(ctx);
    headers.Authorization = `Zoho-oauthtoken ${newToken}`;
    res = await ctx.http.fetch(fullUrl, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
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

// ─── Message Ref Extraction ──────────────────────────────────────────────────

function extractBotDmMessageRef(data: unknown, userId: string): CliqMessageRef {
  const details = (data as any)?.message_details?.[userId];
  return {
    chatId: details?.chat_id ?? undefined,
    messageId: details?.message_id ?? undefined,
  };
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
