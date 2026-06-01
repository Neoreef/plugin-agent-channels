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
import { DATA_CENTERS, JOB_KEYS } from "./constants.js";
import type { DataCenterKey } from "./constants.js";
import type { ZohoAuthState, BotAgentMapping } from "./lib/types.js";
import { proactiveServiceTokenRefresh } from "./lib/cliq-client.js";
import { handleCliqWebhook } from "./modules/cliq/webhook-handler.js";
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

// ─── Per-service state keys ──────────────────────────────────────────────────

function serviceAuthKey(serviceId: string): string {
  return `bridge.service.${serviceId}.auth`;
}

function serviceConfigKey(serviceId: string): string {
  return `bridge.service.${serviceId}.config`;
}

type ServiceOAuthConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  dataCenter: DataCenterKey;
};

async function getServiceAuth(ctx: PluginContext, serviceId: string): Promise<ZohoAuthState | null> {
  return (await ctx.state.get({ scopeKind: "instance", stateKey: serviceAuthKey(serviceId) })) as ZohoAuthState | null;
}

async function getServiceOAuthConfig(ctx: PluginContext, serviceId: string): Promise<ServiceOAuthConfig | null> {
  return (await ctx.state.get({ scopeKind: "instance", stateKey: serviceConfigKey(serviceId) })) as ServiceOAuthConfig | null;
}

// Legacy + per-service fallback
async function getAuthState(ctx: PluginContext): Promise<ZohoAuthState | null> {
  const global = (await ctx.state.get({ scopeKind: "instance", stateKey: "zoho.auth" })) as ZohoAuthState | null;
  if (global?.refreshToken) return global;
  const services = ((await ctx.state.get({ scopeKind: "instance", stateKey: "channels.services" })) as any[] | null) ?? [];
  for (const svc of services) {
    const auth = await getServiceAuth(ctx, svc.id);
    if (auth?.refreshToken) return auth;
  }
  return null;
}

// Find first connected Cliq service ID
async function getCliqServiceId(ctx: PluginContext): Promise<string | null> {
  const services = ((await ctx.state.get({ scopeKind: "instance", stateKey: "channels.services" })) as any[] | null) ?? [];
  for (const svc of services) {
    if (svc.type === "zoho-cliq") {
      const auth = await getServiceAuth(ctx, svc.id);
      if (auth?.refreshToken) return svc.id;
    }
  }
  return null;
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

  // Extract serviceId from state param
  const state = (body.state ?? {}) as Record<string, unknown>;
  const serviceId = state.serviceId as string | undefined;
  if (!serviceId) {
    ctx.logger.error("OAuth callback: no serviceId in state");
    return;
  }

  const oauthConfig = await getServiceOAuthConfig(ctx, serviceId);
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

  await ctx.state.set({ scopeKind: "instance", stateKey: serviceAuthKey(serviceId) }, {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
    dataCenter: dc,
  } satisfies ZohoAuthState);

  ctx.logger.info(`OAuth completed for service ${serviceId} (${dc})`);
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;

    // ─── Jobs ─────────────────────────────────────────────────
    ctx.jobs.register(JOB_KEYS.tokenRefresh, async (_job: PluginJobContext) => {
      // Refresh tokens for all connected services
      const services = ((await ctx.state.get({ scopeKind: "instance", stateKey: "channels.services" })) as any[] | null) ?? [];
      for (const svc of services) {
        try {
          await proactiveServiceTokenRefresh(ctx, svc.id);
        } catch { /* skip unconnected services */ }
      }
      ctx.logger.info("Token refresh job completed");
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
      if (serviceId) {
        let auth = await getServiceAuth(ctx, serviceId);
        if (!auth?.refreshToken) {
          return { connected: false, dataCenter: "US", tokenValid: false };
        }
        if (!auth.expiresAt || Date.now() >= auth.expiresAt) {
          try {
            await proactiveServiceTokenRefresh(ctx, serviceId);
            auth = await getServiceAuth(ctx, serviceId);
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
      const scopes = params.scopes as string;
      if (!serviceId) return { connectUrl: "", configured: false };

      const oauthConfig = await getServiceOAuthConfig(ctx, serviceId);
      if (!oauthConfig?.clientId || !oauthConfig?.callbackUrl) {
        return { connectUrl: "", configured: false };
      }

      const dc = oauthConfig.dataCenter ?? "US";
      const center = DATA_CENTERS[dc] ?? DATA_CENTERS.US;
      const state = encodeURIComponent(JSON.stringify({ serviceId, pluginId: "agent-channels" }));
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

    // ─── Services registry ───────────────────────────────────
    ctx.data.register("services", async () => {
      const services = (await ctx.state.get({ scopeKind: "instance", stateKey: "channels.services" })) as any[] | null;
      return services ?? [];
    });

    // ─── Per-service user notifications (Paperclip → channel) ──
    ctx.data.register("service-notify", async (params) => {
      const serviceId = params.serviceId as string;
      if (!serviceId) return { enabled: false, mappings: [] };
      return await getServiceNotify(ctx, serviceId);
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

    ctx.data.register("cliq-users", async () => {
      try {
        return { users: await listCliqUsers(ctx) };
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
      const config = params.config as ServiceNotifyConfig;
      if (!serviceId || !config) return { ok: false, error: "serviceId and config required" };
      await saveServiceNotify(ctx, serviceId, config);
      return { ok: true };
    });

    ctx.actions.register("add-service", async (params) => {
      const serviceType = params.serviceType as string;
      const services = ((await ctx.state.get({ scopeKind: "instance", stateKey: "channels.services" })) as any[] | null) ?? [];
      const serviceId = `${serviceType}-${Date.now()}`;
      services.push({
        id: serviceId,
        type: serviceType,
        name: (params.name as string) ?? serviceType,
        enabled: true,
        createdAt: new Date().toISOString(),
      });
      await ctx.state.set({ scopeKind: "instance", stateKey: "channels.services" }, services);
      return { ok: true, serviceId };
    });

    ctx.actions.register("remove-service", async (params) => {
      const serviceId = params.serviceId as string;
      const services = ((await ctx.state.get({ scopeKind: "instance", stateKey: "channels.services" })) as any[] | null) ?? [];
      const filtered = services.filter((s: any) => s.id !== serviceId);
      await ctx.state.set({ scopeKind: "instance", stateKey: "channels.services" }, filtered);
      await ctx.state.delete({ scopeKind: "instance", stateKey: serviceConfigKey(serviceId) });
      await ctx.state.delete({ scopeKind: "instance", stateKey: serviceAuthKey(serviceId) });
      return { ok: true };
    });

    // Per-service OAuth config
    ctx.actions.register("save-service-oauth-config", async (params) => {
      const serviceId = params.serviceId as string;
      if (!serviceId) return { ok: false, error: "serviceId required" };
      const oauthConfig: ServiceOAuthConfig = {
        clientId: params.clientId as string ?? "",
        clientSecret: params.clientSecret as string ?? "",
        callbackUrl: params.callbackUrl as string ?? "",
        dataCenter: (params.dataCenter as DataCenterKey) ?? "US",
      };
      await ctx.state.set({ scopeKind: "instance", stateKey: serviceConfigKey(serviceId) }, oauthConfig);
      return { ok: true };
    });

    // Per-service disconnect
    ctx.actions.register("disconnect-service", async (params) => {
      const serviceId = params.serviceId as string;
      if (!serviceId) return { ok: false };
      await ctx.state.delete({ scopeKind: "instance", stateKey: serviceAuthKey(serviceId) });
      ctx.logger.info(`Disconnected service ${serviceId}`);
      return { ok: true };
    });

    // Legacy seed-auth (still useful for bootstrapping)
    ctx.actions.register("seed-auth", async (params) => {
      const serviceId = params.serviceId as string | undefined;
      const authState: ZohoAuthState = {
        refreshToken: params.refreshToken as string,
        accessToken: params.accessToken as string,
        expiresAt: params.expiresAt as number,
        dataCenter: (params.dataCenter as DataCenterKey) ?? "US",
        connectedUser: params.connectedUser as string | undefined,
      };
      if (serviceId) {
        await ctx.state.set({ scopeKind: "instance", stateKey: serviceAuthKey(serviceId) }, authState);
      } else {
        await ctx.state.set({ scopeKind: "instance", stateKey: "zoho.auth" }, authState);
      }
      ctx.logger.info(`Auth state seeded${serviceId ? ` for service ${serviceId}` : ""}`);
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

    switch (input.endpointKey) {
      case "cliq-message":
        await handleCliqWebhook(ctx, input.rawBody, input.parsedBody);
        break;

      case "oauth-callback":
        await handleOAuthCallback(ctx, input);
        break;

      default:
        throw new Error(`Unknown webhook endpoint: ${input.endpointKey}`);
    }
  },

  async onShutdown() {
    currentContext?.logger.info("Agent Channels plugin shutting down");
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
