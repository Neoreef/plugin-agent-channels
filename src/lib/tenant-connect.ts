/**
 * Tenant-facing connect surface (PRE-790 / PRE-329 T2).
 *
 * A tenant holding only their per-company connect link must be able to authorize
 * Zoho and have tokens land in their **company-scoped** store — with zero access
 * to the operator settings UI (`src/ui/index.tsx` → `OAuthSetup`) and without
 * ever touching the operator-only `save-service-oauth-config` action.
 *
 * ## Why this needs no operator credentials
 *
 * The Zoho OAuth *client* (client id + secret + callback URL) is an
 * **app-level** credential shared by every tenant — it already lives in the
 * plugin's operator-managed *instance* config (`manifest.instanceConfigSchema`:
 * `zohoClientId` / `zohoClientSecret` / `oauthCallbackUrl`), and the token
 * refresh path already falls back to it (`cliq-client.ts`). A tenant therefore
 * supplies **nothing secret**: they bring only their `companyId` (baked into
 * their link) and their Zoho org consent. The client *secret* is used solely
 * server-side during the token exchange in `handleOAuthCallback` — it is never
 * placed on the hosted page or in the authorize URL.
 *
 * ## What is per-company
 *
 * The **non-OAuth** knobs — data center, scopes, which channel — are stored
 * per company via the T1 `src/lib/connections/` store scoping (company scope,
 * decoupled from `save-service-oauth-config`). Tokens land per company because
 * the OAuth `state` carries `companyId` and the existing `oauth-callback`
 * webhook writes the token back under that company namespace (NEO-79).
 *
 * ## CSRF
 *
 * Every tenant-issued authorize URL carries a single-use `nonce` persisted under
 * company scope with a short TTL. The callback consumes and validates it (only
 * for `state.src === "tenant"`, so operator connect URLs are unaffected).
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { DATA_CENTERS, CLIQ_SCOPES, type DataCenterKey } from "../constants.js";
import { serviceStore, type ServiceRecord } from "./service-store.js";

/** Channel type the tenant connect page provisions by default. */
export const DEFAULT_TENANT_CHANNEL = "zoho-cliq";

/** Company-scoped state key holding a company's tenant-connect config blob. */
const TENANT_CONFIG_KEY = "channels.tenantConnect.config";
/** Company-scoped key prefix for single-use CSRF nonces. */
const NONCE_KEY_PREFIX = "channels.tenantConnect.nonce";
/** CSRF nonce lifetime — long enough to complete a Zoho consent, short otherwise. */
const NONCE_TTL_MS = 15 * 60_000;

/**
 * Per-company **non-OAuth** connect configuration. Deliberately excludes the
 * client id/secret (those are app-level instance config) so a tenant never sees
 * or supplies operator credentials.
 */
export type TenantConnectConfig = {
  /** Zoho data center for this company (default "US"). */
  dataCenter: DataCenterKey;
  /** Comma-separated OAuth scopes (default: Cliq scopes). */
  scopes: string;
  /** Channel types this company has enabled for self-service connect. */
  enabledChannels: string[];
};

const DEFAULT_TENANT_CONFIG: TenantConnectConfig = {
  dataCenter: "US",
  scopes: CLIQ_SCOPES,
  enabledChannels: [DEFAULT_TENANT_CHANNEL],
};

/** App-level Zoho OAuth client, resolved from operator instance config. */
export type AppOAuthClient = {
  clientId: string;
  /** Present server-side only; never emitted to the tenant page / authorize URL. */
  clientSecret: string;
  callbackUrl: string;
};

/**
 * Read the app-level OAuth client from operator instance config. Returns `null`
 * when the operator has not yet configured the shared Zoho app (client id +
 * callback URL are the minimum needed to *start* a flow).
 */
export async function resolveAppOAuthClient(ctx: PluginContext): Promise<AppOAuthClient | null> {
  const cfg = (await ctx.config.get()) as {
    zohoClientId?: string;
    zohoClientSecret?: string;
    oauthCallbackUrl?: string;
  };
  if (!cfg.zohoClientId || !cfg.oauthCallbackUrl) return null;
  return {
    clientId: cfg.zohoClientId,
    clientSecret: cfg.zohoClientSecret ?? "",
    callbackUrl: cfg.oauthCallbackUrl,
  };
}

// ─── Per-company non-OAuth config (company scope, via T1 store scoping) ────────

/** Read a company's tenant-connect config, applying defaults for missing fields. */
export async function getTenantConnectConfig(
  ctx: PluginContext,
  companyId: string,
): Promise<TenantConnectConfig> {
  const stored = (await ctx.state.get(
    serviceStore.scopeKey(companyId, TENANT_CONFIG_KEY),
  )) as Partial<TenantConnectConfig> | null;
  return {
    dataCenter: stored?.dataCenter ?? DEFAULT_TENANT_CONFIG.dataCenter,
    scopes: stored?.scopes ?? DEFAULT_TENANT_CONFIG.scopes,
    enabledChannels:
      stored?.enabledChannels && stored.enabledChannels.length > 0
        ? stored.enabledChannels
        : DEFAULT_TENANT_CONFIG.enabledChannels,
  };
}

/** Persist a company's tenant-connect config under company scope (T1 store scoping). */
export async function saveTenantConnectConfig(
  ctx: PluginContext,
  companyId: string,
  config: Partial<TenantConnectConfig>,
): Promise<TenantConnectConfig> {
  const merged = { ...(await getTenantConnectConfig(ctx, companyId)), ...config };
  await ctx.state.set(serviceStore.scopeKey(companyId, TENANT_CONFIG_KEY), merged);
  return merged;
}

// ─── Company-scoped service provisioning ──────────────────────────────────────

/**
 * Idempotently ensure a company-scoped service record of `channelType` exists,
 * returning its id. Reuses the first existing service of that type so repeat
 * visits to the connect link don't spawn duplicates. This is what makes tokens
 * land in the company-scoped store: `handleOAuthCallback` writes auth under
 * `serviceStore.setAuth(serviceId, …, companyId)`.
 */
export async function ensureTenantService(
  ctx: PluginContext,
  companyId: string,
  channelType: string,
): Promise<string> {
  const services = await serviceStore.list(ctx, companyId);
  const existing = services.find((s) => s.type === channelType);
  if (existing) return existing.id;

  const serviceId = `${channelType}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const record: ServiceRecord = {
    id: serviceId,
    type: channelType,
    name: channelType,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  await serviceStore.save(ctx, [...services, record], companyId);
  return serviceId;
}

// ─── CSRF nonce (single-use, company-scoped, TTL) ─────────────────────────────

async function issueNonce(ctx: PluginContext, companyId: string, serviceId: string): Promise<string> {
  const nonce = randomUUID();
  await ctx.state.set(serviceStore.scopeKey(companyId, `${NONCE_KEY_PREFIX}.${nonce}`), {
    serviceId,
    expiresAt: Date.now() + NONCE_TTL_MS,
  });
  return nonce;
}

/**
 * Validate + consume a tenant CSRF nonce. Returns `true` only when the nonce
 * exists for this company, matches the `serviceId`, and has not expired. Always
 * deletes the nonce (single use), even on a mismatch, so a leaked value cannot
 * be replayed.
 */
export async function consumeNonce(
  ctx: PluginContext,
  companyId: string,
  serviceId: string,
  nonce: string,
): Promise<boolean> {
  if (!nonce) return false;
  const key = serviceStore.scopeKey(companyId, `${NONCE_KEY_PREFIX}.${nonce}`);
  const rec = (await ctx.state.get(key)) as { serviceId: string; expiresAt: number } | null;
  await ctx.state.delete(key);
  if (!rec) return false;
  if (rec.serviceId !== serviceId) return false;
  if (Date.now() >= rec.expiresAt) return false;
  return true;
}

// ─── The tenant entrypoint: build the authorize URL ───────────────────────────

/** OAuth `state` shape embedded in the authorize URL. Read by `handleOAuthCallback`. */
export type ConnectState = {
  serviceId: string;
  companyId: string;
  channelType: string;
  pluginId: string;
  /** Marks a tenant-issued flow so the callback enforces the CSRF nonce. */
  src?: "tenant";
  nonce?: string;
};

export type TenantConnectResult =
  | { configured: true; connectUrl: string; serviceId: string; channelType: string }
  | { configured: false; reason: string };

/**
 * Assemble a Zoho OAuth authorize URL — the single piece of URL-building logic
 * shared by the tenant entrypoint (this module) and the operator `connect-url`
 * data handler (`worker.ts`), so the two surfaces cannot drift. `state` is a
 * plain object that is JSON-encoded + URL-encoded here; the client *secret* is
 * intentionally not a parameter (it is used only server-side at token exchange).
 */
export function assembleAuthorizeUrl(opts: {
  dataCenter: DataCenterKey;
  clientId: string;
  callbackUrl: string;
  scopes: string;
  state: Record<string, unknown>;
}): string {
  const center = DATA_CENTERS[opts.dataCenter] ?? DATA_CENTERS.US;
  return (
    `https://${center.accounts}/oauth/v2/auth?` +
    new URLSearchParams({
      client_id: opts.clientId,
      response_type: "code",
      scope: opts.scopes,
      redirect_uri: opts.callbackUrl,
      access_type: "offline",
      prompt: "consent",
      state: encodeURIComponent(JSON.stringify(opts.state)),
    }).toString()
  );
}

/**
 * Build the Zoho authorize URL for a company — the reusable tenant entrypoint.
 *
 * Needs no operator UI or credentials: the app-level client comes from instance
 * config, the per-company knobs from company-scoped config, and a company-scoped
 * service is auto-provisioned so the returned token is stored per company. The
 * operator `connect-url` data handler delegates here too, so both surfaces share
 * one code path.
 */
export async function buildTenantConnectUrl(
  ctx: PluginContext,
  opts: { companyId: string; channelType?: string; pluginId: string },
): Promise<TenantConnectResult> {
  const { companyId, pluginId } = opts;
  if (!companyId) return { configured: false, reason: "Missing companyId." };

  const client = await resolveAppOAuthClient(ctx);
  if (!client) {
    return {
      configured: false,
      reason: "This workspace has not finished OAuth app setup yet. Contact your administrator.",
    };
  }

  const config = await getTenantConnectConfig(ctx, companyId);
  const channelType = opts.channelType ?? config.enabledChannels[0] ?? DEFAULT_TENANT_CHANNEL;
  if (!config.enabledChannels.includes(channelType)) {
    return { configured: false, reason: `Channel "${channelType}" is not enabled for this workspace.` };
  }

  const serviceId = await ensureTenantService(ctx, companyId, channelType);
  const nonce = await issueNonce(ctx, companyId, serviceId);

  const state: ConnectState = { serviceId, companyId, channelType, pluginId, src: "tenant", nonce };
  const connectUrl = assembleAuthorizeUrl({
    dataCenter: config.dataCenter,
    clientId: client.clientId,
    callbackUrl: client.callbackUrl,
    scopes: config.scopes,
    state: state as unknown as Record<string, unknown>,
  });

  return { configured: true, connectUrl, serviceId, channelType };
}

// ─── The hosted "Connect your org" page ───────────────────────────────────────

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/**
 * Render the tenant "Connect your org" page (parameterized by companyId). Pure
 * string builder so it is trivially testable and transport-agnostic — the host
 * `onApiRequest` route serves it, and Nicole's Caddy landing gateway (PRE-789)
 * fronts it. No secrets are emitted: only the authorize URL (which contains the
 * public client id) appears.
 */
export function renderConnectPage(result: TenantConnectResult): string {
  const shell = (title: string, body: string): string =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title><style>` +
    `body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e8eb;` +
    `display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}` +
    `.card{background:#171a21;border:1px solid #262b36;border-radius:14px;padding:40px;max-width:440px;text-align:center}` +
    `h1{font-size:20px;margin:0 0 8px}p{color:#9aa4b2;line-height:1.5;margin:0 0 24px}` +
    `.btn{display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:12px 24px;` +
    `border-radius:8px;font-weight:600}.muted{font-size:13px;color:#6b7280;margin-top:20px}` +
    `</style></head><body><div class="card">${body}</div></body></html>`;

  if (!result.configured) {
    return shell(
      "Connect your org",
      `<h1>Not ready to connect</h1><p>${escapeHtml(result.reason)}</p>`,
    );
  }
  return shell(
    "Connect your org",
    `<h1>Connect your workspace</h1>` +
      `<p>Authorize Zoho to let your Cortex agents message your team through Cliq. ` +
      `Tokens are stored only for your workspace.</p>` +
      `<a class="btn" href="${escapeHtml(result.connectUrl)}" rel="noopener">Connect Zoho</a>` +
      `<p class="muted">You'll be redirected to Zoho to sign in and grant access.</p>`,
  );
}
