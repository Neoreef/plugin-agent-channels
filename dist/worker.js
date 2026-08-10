/**
 * Agent Channels plugin worker.
 * Routes agent conversations through messaging channels (Zoho Cliq first).
 *
 * Per-service OAuth pattern — each channel service owns its own OAuth credentials
 * and auth tokens, stored in bridge.service.{serviceId}.config / .auth.
 */
import { definePlugin, runWorker, } from "@paperclipai/plugin-sdk";
import { API_ROUTE_KEYS, DATA_CENTERS, JOB_KEYS, PLUGIN_ID, WEBHOOK_KEYS } from "./constants.js";
import { assembleAuthorizeUrl, buildTenantConnectUrl, consumeNonce, getTenantConnectConfig, renderConnectPage, resolveAppOAuthClient, } from "./lib/tenant-connect.js";
import { proactiveServiceTokenRefresh } from "./lib/cliq-client.js";
import { listServices, saveServices, getServiceAuth, saveServiceAuth, deleteServiceAuth, getServiceOAuthConfig, saveServiceOAuthConfig, deleteServiceOAuthConfig, getServiceType, findConnectedService, } from "./lib/service-store.js";
import { getChannel, getChannelByServiceType } from "./lib/channel-registry.js";
// Side-effect import: registers all built-in channel modules into the registry.
import "./channels.js";
import { getBotMappings, saveBotMappings } from "./modules/cliq/bot-mapping.js";
import { getServiceNotify, saveServiceNotify, listPaperclipUsers, } from "./modules/notifications/service-notify.js";
import { listCliqUsers } from "./lib/cliq-client.js";
import { notifyApprovalCreated } from "./modules/notifications/approvals.js";
import { notifyIssueBlocked } from "./modules/notifications/blocked.js";
let currentContext = null;
// Token storage helpers (service registry, auth, config) live in
// service-store.js, namespaced per company (NEO-79) with legacy-global fallback.
// Legacy + per-service fallback — global health view (no company scope).
async function getAuthState(ctx) {
    const global = (await ctx.state.get({ scopeKind: "instance", stateKey: "zoho.auth" }));
    if (global?.refreshToken)
        return global;
    const found = await findConnectedService(ctx, "zoho-cliq");
    return found?.auth ?? null;
}
// ─── OAuth Callback ──────────────────────────────────────────────────────────
async function handleOAuthCallback(ctx, input) {
    const body = (input.parsedBody ?? {});
    const rawBody = input.rawBody ?? "";
    let code = body.code;
    if (!code && rawBody.includes("code=")) {
        code = new URLSearchParams(rawBody).get("code") ?? undefined;
    }
    if (!code) {
        ctx.logger.error("OAuth callback: no code");
        return;
    }
    // Extract serviceId + companyId + channelType from state param. `companyId`
    // routes token storage to the right company namespace (NEO-79); `channelType`
    // routes post-auth setup to the right channel module (defaults to the
    // service's registered type below when absent, for backward compatibility).
    const state = (body.state ?? {});
    const serviceId = state.serviceId;
    const companyId = state.companyId;
    const channelType = state.channelType;
    if (!serviceId) {
        ctx.logger.error("OAuth callback: no serviceId in state");
        return;
    }
    // CSRF: tenant-issued flows (hosted "Connect your org" page, PRE-790) carry a
    // single-use, company-scoped nonce. Validate + consume it before touching any
    // credentials. Operator connect URLs omit `src: "tenant"` and are unaffected.
    if (state.src === "tenant") {
        const ok = await consumeNonce(ctx, companyId ?? "", serviceId, state.nonce ?? "");
        if (!ok) {
            ctx.logger.error(`OAuth callback: rejected tenant flow — invalid/expired CSRF nonce (service ${serviceId})`);
            return;
        }
    }
    // Resolve OAuth client credentials. Operator connections store them per
    // service (`save-service-oauth-config`); tenant self-service connections
    // (PRE-790) never set per-service creds and instead use the shared app-level
    // client from operator instance config — so fall back to it, mirroring the
    // token-refresh path in cliq-client.ts.
    const oauthConfig = await getServiceOAuthConfig(ctx, serviceId, companyId);
    const appClient = await resolveAppOAuthClient(ctx);
    const clientId = oauthConfig?.clientId || appClient?.clientId;
    const clientSecret = oauthConfig?.clientSecret || appClient?.clientSecret;
    const callbackUrl = oauthConfig?.callbackUrl || appClient?.callbackUrl;
    if (!clientId || !clientSecret) {
        ctx.logger.error(`OAuth callback: no credentials for service ${serviceId}`);
        return;
    }
    // Data center: per-service config wins; otherwise the company's tenant-connect
    // config (which drove the authorize URL) so the token center matches.
    const dc = oauthConfig?.dataCenter ?? (companyId ? (await getTenantConnectConfig(ctx, companyId)).dataCenter : "US");
    const center = DATA_CENTERS[dc] ?? DATA_CENTERS.US;
    const params = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        ...(callbackUrl ? { redirect_uri: callbackUrl } : {}),
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
    const data = (await res.json());
    if (!data.access_token || !data.refresh_token) {
        ctx.logger.error(`OAuth returned incomplete data for ${serviceId}`);
        return;
    }
    const authState = {
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
            }
            catch (err) {
                ctx.logger.error(`onOAuthComplete failed for ${routeType}: ${String(err)}`);
            }
        }
    }
}
// ─── Plugin ─────────────────────────────────────────────────────────────────
const plugin = definePlugin({
    async setup(ctx) {
        currentContext = ctx;
        // ─── Jobs ─────────────────────────────────────────────────
        ctx.jobs.register(JOB_KEYS.tokenRefresh, async (_job) => {
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
                        }
                        catch { /* skip unconnected services */ }
                    }
                }
            }
            catch (err) {
                ctx.logger.error(`Token refresh: company iteration failed: ${String(err)}`);
            }
            // Legacy global services (no company scope).
            for (const svc of await listServices(ctx)) {
                try {
                    await proactiveServiceTokenRefresh(ctx, svc.id);
                    refreshed++;
                }
                catch { /* skip */ }
            }
            ctx.logger.info(`Token refresh job completed (${refreshed} service(s))`);
        });
        // ─── Events: approval + blocked-item notifications → Cliq ──
        ctx.events.on("approval.created", async (event) => {
            try {
                await notifyApprovalCreated(ctx, event);
            }
            catch (err) {
                ctx.logger.error(`approval.created handler failed: ${String(err)}`);
            }
        });
        ctx.events.on("issue.relations.updated", async (event) => {
            try {
                await notifyIssueBlocked(ctx, event);
            }
            catch (err) {
                ctx.logger.error(`issue.relations.updated handler failed: ${String(err)}`);
            }
        });
        // ─── Per-service connection status ────────────────────────
        ctx.data.register("connection-status", async (params) => {
            const serviceId = params.serviceId;
            const companyId = params.companyId;
            if (serviceId) {
                let auth = await getServiceAuth(ctx, serviceId, companyId);
                if (!auth?.refreshToken) {
                    return { connected: false, dataCenter: "US", tokenValid: false };
                }
                if (!auth.expiresAt || Date.now() >= auth.expiresAt) {
                    try {
                        await proactiveServiceTokenRefresh(ctx, serviceId, companyId);
                        auth = await getServiceAuth(ctx, serviceId, companyId);
                    }
                    catch { /* report as expired */ }
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
            const serviceId = params.serviceId;
            const companyId = params.companyId;
            const scopes = params.scopes;
            if (!serviceId)
                return { connectUrl: "", configured: false };
            const oauthConfig = await getServiceOAuthConfig(ctx, serviceId, companyId);
            if (!oauthConfig?.clientId || !oauthConfig?.callbackUrl) {
                return { connectUrl: "", configured: false };
            }
            // Embed companyId (NEO-79 — namespace routing on return) and channelType so
            // the OAuth callback can store the token under the right company and route
            // post-auth setup to the right channel module (see handleOAuthCallback /
            // ChannelModule.onOAuthComplete). URL assembly is shared with the tenant
            // entrypoint (buildTenantConnectUrl) so the two surfaces cannot drift.
            const channelType = params.channelType ?? (await getServiceType(ctx, serviceId, companyId));
            const connectUrl = assembleAuthorizeUrl({
                dataCenter: oauthConfig.dataCenter ?? "US",
                clientId: oauthConfig.clientId,
                callbackUrl: oauthConfig.callbackUrl,
                scopes,
                state: { serviceId, companyId, channelType, pluginId: PLUGIN_ID },
            });
            return { connectUrl, configured: true };
        });
        ctx.data.register("bot-mappings", async () => {
            return await getBotMappings(ctx);
        });
        ctx.data.register("paperclip-companies", async () => {
            try {
                const companies = await ctx.companies.list({ limit: 50, offset: 0 });
                return { companies: companies.map((c) => ({ id: c.id, name: c.name })) };
            }
            catch (e) {
                return { companies: [], error: String(e) };
            }
        });
        ctx.data.register("paperclip-agents", async (params) => {
            try {
                const companyId = params.companyId;
                if (!companyId)
                    return { agents: [] };
                const agents = await ctx.agents.list({ companyId, limit: 200, offset: 0 });
                return { agents: agents.map((a) => ({ id: a.id, name: a.name, role: a.role })) };
            }
            catch (e) {
                return { agents: [], error: String(e) };
            }
        });
        // ─── Services registry (per company — NEO-79) ─────────────
        ctx.data.register("services", async (params) => {
            const companyId = params.companyId;
            return await listServices(ctx, companyId);
        });
        // ─── Per-service user notifications (Paperclip → channel) ──
        ctx.data.register("service-notify", async (params) => {
            const serviceId = params.serviceId;
            const companyId = params.companyId;
            if (!serviceId)
                return { enabled: false, mappings: [] };
            return await getServiceNotify(ctx, serviceId, companyId);
        });
        ctx.data.register("paperclip-users", async (params) => {
            try {
                const companyId = params.companyId;
                if (!companyId)
                    return { users: [] };
                return { users: await listPaperclipUsers(ctx, companyId) };
            }
            catch (e) {
                return { users: [], error: String(e) };
            }
        });
        ctx.data.register("cliq-users", async (params) => {
            try {
                const companyId = params.companyId;
                const serviceId = params.serviceId;
                return { users: await listCliqUsers(ctx, { companyId, serviceId }) };
            }
            catch (e) {
                return { users: [], error: String(e) };
            }
        });
        // ─── Action Handlers ─────────────────────────────────────
        ctx.actions.register("save-bot-mappings", async (params) => {
            const mappings = params.mappings;
            await saveBotMappings(ctx, mappings);
            return { ok: true };
        });
        ctx.actions.register("save-service-notify", async (params) => {
            const serviceId = params.serviceId;
            const companyId = params.companyId;
            const config = params.config;
            if (!serviceId || !config)
                return { ok: false, error: "serviceId and config required" };
            await saveServiceNotify(ctx, serviceId, config, companyId);
            return { ok: true };
        });
        ctx.actions.register("add-service", async (params) => {
            const serviceType = params.serviceType;
            const companyId = params.companyId;
            const services = await listServices(ctx, companyId);
            const serviceId = `${serviceType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            services.push({
                id: serviceId,
                type: serviceType,
                name: params.name ?? serviceType,
                enabled: true,
                createdAt: new Date().toISOString(),
            });
            await saveServices(ctx, services, companyId);
            return { ok: true, serviceId };
        });
        ctx.actions.register("remove-service", async (params) => {
            const serviceId = params.serviceId;
            const companyId = params.companyId;
            const services = await listServices(ctx, companyId);
            const filtered = services.filter((s) => s.id !== serviceId);
            await saveServices(ctx, filtered, companyId);
            await deleteServiceOAuthConfig(ctx, serviceId, companyId);
            await deleteServiceAuth(ctx, serviceId, companyId);
            return { ok: true };
        });
        // Per-service OAuth config
        ctx.actions.register("save-service-oauth-config", async (params) => {
            const serviceId = params.serviceId;
            const companyId = params.companyId;
            if (!serviceId)
                return { ok: false, error: "serviceId required" };
            const oauthConfig = {
                clientId: params.clientId ?? "",
                clientSecret: params.clientSecret ?? "",
                callbackUrl: params.callbackUrl ?? "",
                dataCenter: params.dataCenter ?? "US",
            };
            await saveServiceOAuthConfig(ctx, serviceId, oauthConfig, companyId);
            return { ok: true };
        });
        // Per-service disconnect
        ctx.actions.register("disconnect-service", async (params) => {
            const serviceId = params.serviceId;
            const companyId = params.companyId;
            if (!serviceId)
                return { ok: false };
            await deleteServiceAuth(ctx, serviceId, companyId);
            ctx.logger.info(`Disconnected service ${serviceId}${companyId ? ` company=${companyId}` : ""}`);
            return { ok: true };
        });
        // Legacy seed-auth (still useful for bootstrapping)
        ctx.actions.register("seed-auth", async (params) => {
            const serviceId = params.serviceId;
            const companyId = params.companyId;
            const authState = {
                refreshToken: params.refreshToken,
                accessToken: params.accessToken,
                expiresAt: params.expiresAt,
                dataCenter: params.dataCenter ?? "US",
                connectedUser: params.connectedUser,
            };
            if (serviceId) {
                await saveServiceAuth(ctx, serviceId, authState, companyId);
            }
            else {
                await ctx.state.set({ scopeKind: "instance", stateKey: "zoho.auth" }, authState);
            }
            ctx.logger.info(`Auth state seeded${serviceId ? ` for service ${serviceId}` : ""}${companyId ? ` company=${companyId}` : ""}`);
            return { ok: true };
        });
        ctx.logger.info("Agent Channels plugin setup complete");
    },
    async onHealth() {
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
    async onWebhook(input) {
        const ctx = currentContext;
        if (!ctx)
            throw new Error("Plugin not initialized");
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
            ctx.logger.info(`Channel ${channel.getServiceType()} did not handle ${input.endpointKey}` +
                (result.note ? `: ${result.note}` : ""));
        }
    },
    // ─── Scoped API routes ───────────────────────────────────────
    // Public per-tenant "Connect your org" surface (PRE-790 / PRE-329 T2). The
    // host mounts this under /api/plugins/agent-channels/api/connect and resolves
    // `companyId` from the query (manifest `apiRoutes[].companyResolution`). A
    // tenant needs only this link — no operator UI, no operator credentials.
    async onApiRequest(input) {
        const ctx = currentContext;
        if (!ctx)
            throw new Error("Plugin not initialized");
        if (input.routeKey === API_ROUTE_KEYS.tenantConnect) {
            const companyId = input.companyId || (typeof input.query.companyId === "string" ? input.query.companyId : "");
            const channelType = typeof input.query.channelType === "string" ? input.query.channelType : undefined;
            const result = await buildTenantConnectUrl(ctx, { companyId, channelType, pluginId: PLUGIN_ID });
            const status = result.configured ? 200 : 409;
            // `?format=json` returns the authorize URL for programmatic callers (e.g.
            // Caddy landing templating, PRE-789); default serves the hosted HTML page.
            if (input.query.format === "json") {
                const body = result.configured
                    ? { configured: true, connectUrl: result.connectUrl, serviceId: result.serviceId, channelType: result.channelType }
                    : { configured: false, reason: result.reason };
                return { status, headers: { "content-type": "application/json; charset=utf-8" }, body };
            }
            return { status, headers: { "content-type": "text/html; charset=utf-8" }, body: renderConnectPage(result) };
        }
        return { status: 404, headers: { "content-type": "application/json; charset=utf-8" }, body: { error: `Unknown route: ${input.routeKey}` } };
    },
    async onShutdown() {
        currentContext?.logger.info("Agent Channels plugin shutting down");
    },
});
export default plugin;
runWorker(plugin, import.meta.url);
//# sourceMappingURL=worker.js.map