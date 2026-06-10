/**
 * Agent Channels plugin worker.
 * Routes agent conversations through messaging channels (Zoho Cliq first).
 *
 * Per-service OAuth pattern — each channel service owns its own OAuth credentials
 * and auth tokens, stored in bridge.service.{serviceId}.config / .auth.
 */

import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginHealthDiagnostics,
  type PluginJobContext,
  type PluginWebhookInput,
} from "@paperclipai/plugin-sdk";
import { DATA_CENTERS, JOB_KEYS, WEBHOOK_KEYS } from "./constants.js";
import type { DataCenterKey } from "./constants.js";
import type { ZohoAuthState, BotAgentMapping } from "./lib/types.js";
import { proactiveServiceTokenRefresh } from "./lib/cliq-client.js";
import {
  type ServiceOAuthConfig,
  type ServiceRecord,
  listServices,
  saveServices,
  getServiceAuth,
  saveServiceAuth,
  deleteServiceAuth,
  getServiceOAuthConfig,
  saveServiceOAuthConfig,
  deleteServiceOAuthConfig,
  getServiceType,
  findConnectedService,
} from "./lib/service-store.js";
import { getChannel, getChannelByServiceType } from "./lib/channel-registry.js";
// Side-effect import: registers all built-in channel modules into the registry.
import "./channels.js";
import { getBotMappings, saveBotMappings } from "./modules/cliq/bot-mapping.js";
import {
  getServiceNotify,
  saveServiceNotify,
  listPaperclipUsers,
  type ServiceNotifyConfig,
} from "./modules/notifications/service-notify.js";
import { listCliqUsers } from "./lib/cliq-client.js";
import { notifyApprovalCreated } from "./modules/notifications/approvals.js";
import { notifyIssueBlocked } from "./modules/notifications/blocked.js";

let currentContext: PluginContext | null = null;

// Token storage helpers (service registry, auth, config) live in
// service-store.js, namespaced per company (NEO-79) with legacy-global fallback.

// Legacy + per-service fallback — global health view (no company scope).
async function getAuthState(ctx: PluginContext): Promise<ZohoAuthState | null> {
  const global = (await ctx.state.get({ scopeKind: "instance", stateKey: "zoho.auth" })) as ZohoAuthState | null;
  if (global?.refreshToken) return global;
  const found = await findConnectedService(ctx, "zoho-cliq");
  return found?.auth ?? null;
}

// ─── OAuth Callback ──────────────────────────────────────────────────────────

async function handleOAuthCallback(ctx: PluginContext, input: PluginWebhookInput): Promise<void> {
  const body = (input.parsedBody ?? {}) as Record<string, unknown>;
  const rawBody = input.rawBody ?? "";

  let code = body.code as string | undefined;
  if (!code && rawBody.includes("code=")) {
    code = new URLSearchParams(rawBody).get("code") ?? undefined;
  }
  if (!code) { ctx.logger.error("OAuth callback: no code"); return; }

  // Extract serviceId + companyId + channelType from state param. `companyId`
  // routes token storage to the right company namespace (NEO-79); `channelType`
  // routes post-auth setup to the right channel module (defaults to the
  // service's registered type below when absent, for backward compatibility).
  const state = (body.state ?? {}) as Record<string, unknown>;
  const serviceId = state.serviceId as string | undefined;
  const companyId = state.companyId as string | undefined;
  const channelType = state.channelType as string | undefined;
  if (!serviceId) {
    ctx.logger.error("OAuth callback: no serviceId in state");
    return;
  }

  const oauthConfig = await getServiceOAuthConfig(ctx, serviceId, companyId);
  if (!oauthConfig?.clientId || !oauthConfig?.clientSecret) {
    ctx.logger.error(`OAuth callback: no credentials for service ${serviceId}`);
    return;
  }

  const dc = oauthConfig.dataCenter ?? "US";
  const center = DATA_CENTERS[dc] ?? DATA_CENTERS.US;

  const params = new URLSearchParams({
    code,
    client_id: oauthConfig.clientId,
    client_secret: oauthConfig.clientSecret,
    grant_type: "authorization_code",
    ...(oauthConfig.callbackUrl ? { redirect_uri: oauthConfig.callbackUrl } : {}),
  });

  const res = await ctx.http.fetch(`https://${center.accounts}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    ctx.logger.error(`OAuth exchange failed for ${serviceId}: ${await res.text()}`);
    return;
  }

  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token || !data.refresh_token) {
    ctx.logger.error(`OAuth returned incomplete data for ${serviceId}`);
    return;
  }

  const authState: ZohoAuthState = {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
    dataCenter: dc,
  };
  await saveServiceAuth(ctx, serviceId, authState, companyId);

  ctx.logger.info(`OAuth completed for service ${serviceId} (${dc})${companyId ? ` company=${companyId}` : ""}`);

  // Route post-auth setup to the channel module. Prefer the explicit
  // `state.channelType`; fall back to the service's stored type so existing
  // connect URLs (which omit channelType) keep working.
  const routeType = channelType ?? (await getServiceType(ctx, serviceId, companyId));
  if (routeType) {
    const channel = getChannelByServiceType(routeType);
    if (channel?.onOAuthComplete) {
      try {
        await channel.onOAuthComplete(ctx, serviceId, authState, companyId);
      } catch (err) {
        ctx.logger.error(`onOAuthComplete failed for ${routeType}: ${String(err)}`);
      }
    }
  }
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;

    // ─── Jobs ─────────────────────────────────────────────────
    ctx.jobs.register(JOB_KEYS.tokenRefresh, async (_job: PluginJobContext) => {
      // Refresh tokens for every company's connected services (NEO-79). Each
      // company namespaces its own `channels.services`, so iterate companies and
      // refresh per company. Also sweep any legacy instance-scoped services.
      let refreshed = 0;
      try {
        const companies = await ctx.companies.list({ limit: 200, offset: 0 });
        for (const company of companies) {
          const services = await listServices(ctx, company.id);
          for (const svc of services) {
            try {
              await proactiveServiceTokenRefresh(ctx, svc.id, company.id);
              refreshed++;
            } catch { /* skip unconnected services */ }
          }
        }
      } catch (err) {
        ctx.logger.error(`Token refresh: company iteration failed: ${String(err)}`);
      }
      // Legacy global services (no company scope).
      for (const svc of await listServices(ctx)) {
        try {
          await proactiveServiceTokenRefresh(ctx, svc.id);
          refreshed++;
        } catch { /* skip */ }
      }
      ctx.logger.info(`Token refresh job completed (${refreshed} service(s))`);
    });

    // ─── Events: approval + blocked-item notifications → Cliq ──
    ctx.events.on("approval.created", async (event) => {
      try {
        await notifyApprovalCreated(ctx, event);
      } catch (err) {
        ctx.logger.error(`approval.created handler failed: ${String(err)}`);
      }
    });

    ctx.events.on("issue.relations.updated", async (event) => {
      try {
        await notifyIssueBlocked(ctx, event);
      } catch (err) {
        ctx.logger.error(`issue.relations.updated handler failed: ${String(err)}`);
      }
    });

    // ─── Per-service connection status ────────────────────────
    ctx.data.register("connection-status", async (params) => {
      const serviceId = params.serviceId as string | undefined;
      const companyId = params.companyId as string | undefined;
      if (serviceId) {
        let auth = await getServiceAuth(ctx, serviceId, companyId);
        if (!auth?.refreshToken) {
          return { connected: false, dataCenter: "US", tokenValid: false };
        }
        if (!auth.expiresAt || Date.now() >= auth.expiresAt) {
          try {
            await proactiveServiceTokenRefresh(ctx, serviceId, companyId);
            auth = await getServiceAuth(ctx, serviceId, companyId);
          } catch { /* report as expired */ }
        }
        return {
          connected: true,
          dataCenter: auth?.dataCenter ?? "US",
          tokenExpiresAt: auth?.expiresAt,
          tokenValid: auth?.expiresAt ? Date.now() < auth.expiresAt : false,
        };
      }
      // Legacy: global
      const auth = await getAuthState(ctx);
      return {
        connected: !!auth?.refreshToken,
        dataCenter: auth?.dataCenter ?? "US",
        tokenExpiresAt: auth?.expiresAt,
        tokenValid: auth?.expiresAt ? Date.now() < auth.expiresAt : false,
      };
    });

    // ─── Per-service connect URL ──────────────────────────────
    ctx.data.register("connect-url", async (params) => {
      const serviceId = params.serviceId as string;
      const companyId = params.companyId as string | undefined;
      const scopes = params.scopes as string;
      if (!serviceId) return { connectUrl: "", configured: false };

      const oauthConfig = await getServiceOAuthConfig(ctx, serviceId, companyId);
      if (!oauthConfig?.clientId || !oauthConfig?.callbackUrl) {
        return { connectUrl: "", configured: false };
      }

      const dc = oauthConfig.dataCenter ?? "US";
      const center = DATA_CENTERS[dc] ?? DATA_CENTERS.US;
      // Embed companyId (NEO-79 — namespace routing on return) and channelType so
      // the OAuth callback can store the token under the right company and route
      // post-auth setup to the right channel module (see handleOAuthCallback /
      // ChannelModule.onOAuthComplete).
      const channelType = (params.channelType as string | undefined) ?? (await getServiceType(ctx, serviceId, companyId));
      const state = encodeURIComponent(
        JSON.stringify({ serviceId, companyId, channelType, pluginId: "agent-channels" }),
      );
      const connectUrl = `https://${center.accounts}/oauth/v2/auth?` +
        new URLSearchParams({
          client_id: oauthConfig.clientId,
          response_type: "code",
          scope: scopes,
          redirect_uri: oauthConfig.callbackUrl,
          access_type: "offline",
          prompt: "consent",
          state,
        }).toString();
      return { connectUrl, configured: true };
    });

    ctx.data.register("bot-mappings", async () => {
      return await getBotMappings(ctx);
    });

    ctx.data.register("paperclip-companies", async () => {
      try {
        const companies = await ctx.companies.list({ limit: 50, offset: 0 });
        return { companies: companies.map((c) => ({ id: c.id, name: c.name })) };
      } catch (e) {
        return { companies: [], error: String(e) };
      }
    });

    ctx.data.register("paperclip-agents", async (params) => {
      try {
        const companyId = params.companyId as string;
        if (!companyId) return { agents: [] };
        const agents = await ctx.agents.list({ companyId, limit: 200, offset: 0 });
        return { agents: agents.map((a) => ({ id: a.id, name: a.name, role: a.role })) };
      } catch (e) {
        return { agents: [], error: String(e) };
      }
    });

    // ─── Services registry (per company — NEO-79) ─────────────
    ctx.data.register("services", async (params) => {
      const companyId = params.companyId as string | undefined;
      return await listServices(ctx, companyId);
    });

    // ─── Per-service user notifications (Paperclip → channel) ──
    ctx.data.register("service-notify", async (params) => {
      const serviceId = params.serviceId as string;
      const companyId = params.companyId as string | undefined;
      if (!serviceId) return { enabled: false, mappings: [] };
      return await getServiceNotify(ctx, serviceId, companyId);
    });

    ctx.data.register("paperclip-users", async (params) => {
      try {
        const companyId = params.companyId as string;
        if (!companyId) return { users: [] };
        return { users: await listPaperclipUsers(ctx, companyId) };
      } catch (e) {
        return { users: [], error: String(e) };
      }
    });

    ctx.data.register("cliq-users", async (params) => {
      try {
        const companyId = params.companyId as string | undefined;
        const serviceId = params.serviceId as string | undefined;
        return { users: await listCliqUsers(ctx, { companyId, serviceId }) };
      } catch (e) {
        return { users: [], error: String(e) };
      }
    });

    // ─── Action Handlers ─────────────────────────────────────

    ctx.actions.register("save-bot-mappings", async (params) => {
      const mappings = params.mappings as BotAgentMapping[];
      await saveBotMappings(ctx, mappings);
      return { ok: true };
    });

    ctx.actions.register("save-service-notify", async (params) => {
      const serviceId = params.serviceId as string;
      const companyId = params.companyId as string | undefined;
      const config = params.config as ServiceNotifyConfig;
      if (!serviceId || !config) return { ok: false, error: "serviceId and config required" };
      await saveServiceNotify(ctx, serviceId, config, companyId);
      return { ok: true };
    });

    ctx.actions.register("add-service", async (params) => {
      const serviceType = params.serviceType as string;
      const companyId = params.companyId as string | undefined;
      const services = await listServices(ctx, companyId);
      const serviceId = `${serviceType}-${Date.now()}`;
      services.push({
        id: serviceId,
        type: serviceType,
        name: (params.name as string) ?? serviceType,
        enabled: true,
        createdAt: new Date().toISOString(),
      });
      await saveServices(ctx, services, companyId);
      return { ok: true, serviceId };
    });

    ctx.actions.register("remove-service", async (params) => {
      const serviceId = params.serviceId as string;
      const companyId = params.companyId as string | undefined;
      const services = await listServices(ctx, companyId);
      const filtered = services.filter((s: ServiceRecord) => s.id !== serviceId);
      await saveServices(ctx, filtered, companyId);
      await deleteServiceOAuthConfig(ctx, serviceId, companyId);
      await deleteServiceAuth(ctx, serviceId, companyId);
      return { ok: true };
    });

    // Per-service OAuth config
    ctx.actions.register("save-service-oauth-config", async (params) => {
      const serviceId = params.serviceId as string;
      const companyId = params.companyId as string | undefined;
      if (!serviceId) return { ok: false, error: "serviceId required" };
      const oauthConfig: ServiceOAuthConfig = {
        clientId: params.clientId as string ?? "",
        clientSecret: params.clientSecret as string ?? "",
        callbackUrl: params.callbackUrl as string ?? "",
        dataCenter: (params.dataCenter as DataCenterKey) ?? "US",
      };
      await saveServiceOAuthConfig(ctx, serviceId, oauthConfig, companyId);
      return { ok: true };
    });

    // Per-service disconnect
    ctx.actions.register("disconnect-service", async (params) => {
      const serviceId = params.serviceId as string;
      const companyId = params.companyId as string | undefined;
      if (!serviceId) return { ok: false };
      await deleteServiceAuth(ctx, serviceId, companyId);
      ctx.logger.info(`Disconnected service ${serviceId}${companyId ? ` company=${companyId}` : ""}`);
      return { ok: true };
    });

    // Legacy seed-auth (still useful for bootstrapping)
    ctx.actions.register("seed-auth", async (params) => {
      const serviceId = params.serviceId as string | undefined;
      const companyId = params.companyId as string | undefined;
      const authState: ZohoAuthState = {
        refreshToken: params.refreshToken as string,
        accessToken: params.accessToken as string,
        expiresAt: params.expiresAt as number,
        dataCenter: (params.dataCenter as DataCenterKey) ?? "US",
        connectedUser: params.connectedUser as string | undefined,
      };
      if (serviceId) {
        await saveServiceAuth(ctx, serviceId, authState, companyId);
      } else {
        await ctx.state.set({ scopeKind: "instance", stateKey: "zoho.auth" }, authState);
      }
      ctx.logger.info(`Auth state seeded${serviceId ? ` for service ${serviceId}` : ""}${companyId ? ` company=${companyId}` : ""}`);
      return { ok: true };
    });

    ctx.logger.info("Agent Channels plugin setup complete");
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    const ctx = currentContext;
    if (!ctx) {
      return { status: "error", message: "Plugin not initialized" };
    }

    const auth = await getAuthState(ctx);
    const connected = !!auth?.refreshToken;
    const tokenValid = auth?.expiresAt ? Date.now() < auth.expiresAt : false;
    const mappings = await getBotMappings(ctx);
    const activeBots = mappings.filter((m) => m.enabled).length;

    return {
      status: connected ? "ok" : "degraded",
      message: connected
        ? `Connected to Zoho (${auth?.dataCenter ?? "US"})${tokenValid ? "" : " — token expired"}. ${activeBots} bot(s) mapped.`
        : "Not connected to Zoho. Complete OAuth setup in settings.",
      details: { connected, dataCenter: auth?.dataCenter, tokenValid, activeBots },
    };
  },

  async onConfigChanged(newConfig) {
    currentContext?.logger.info(`Config changed: ${JSON.stringify(newConfig)}`);
  },

  async onWebhook(input: PluginWebhookInput) {
    const ctx = currentContext;
    if (!ctx) throw new Error("Plugin not initialized");

    // OAuth callback is shared channel infrastructure — one endpoint for every
    // channel, routed to the right channel by `state.channelType` after token
    // exchange (see handleOAuthCallback).
    if (input.endpointKey === WEBHOOK_KEYS.oauthCallback) {
      await handleOAuthCallback(ctx, input);
      return;
    }

    // All other webhooks dispatch through the channel registry — adding a
    // channel is a registration call (src/channels.ts), not a core edit.
    const channel = getChannel(input.endpointKey);
    if (!channel) {
      throw new Error(`Unknown webhook endpoint: ${input.endpointKey}`);
    }
    const result = await channel.handleWebhook(ctx, input);
    if (!result.handled) {
      ctx.logger.info(
        `Channel ${channel.getServiceType()} did not handle ${input.endpointKey}` +
          (result.note ? `: ${result.note}` : ""),
      );
    }
  },

  async onShutdown() {
    currentContext?.logger.info("Agent Channels plugin shutting down");
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
