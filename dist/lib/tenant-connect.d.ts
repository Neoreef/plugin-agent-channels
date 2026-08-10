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
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { type DataCenterKey } from "../constants.js";
/** Channel type the tenant connect page provisions by default. */
export declare const DEFAULT_TENANT_CHANNEL = "zoho-cliq";
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
export declare function resolveAppOAuthClient(ctx: PluginContext): Promise<AppOAuthClient | null>;
/** Read a company's tenant-connect config, applying defaults for missing fields. */
export declare function getTenantConnectConfig(ctx: PluginContext, companyId: string): Promise<TenantConnectConfig>;
/** Persist a company's tenant-connect config under company scope (T1 store scoping). */
export declare function saveTenantConnectConfig(ctx: PluginContext, companyId: string, config: Partial<TenantConnectConfig>): Promise<TenantConnectConfig>;
/**
 * Idempotently ensure a company-scoped service record of `channelType` exists,
 * returning its id. Reuses the first existing service of that type so repeat
 * visits to the connect link don't spawn duplicates. This is what makes tokens
 * land in the company-scoped store: `handleOAuthCallback` writes auth under
 * `serviceStore.setAuth(serviceId, …, companyId)`.
 */
export declare function ensureTenantService(ctx: PluginContext, companyId: string, channelType: string): Promise<string>;
/**
 * Validate + consume a tenant CSRF nonce. Returns `true` only when the nonce
 * exists for this company, matches the `serviceId`, and has not expired. Always
 * deletes the nonce (single use), even on a mismatch, so a leaked value cannot
 * be replayed.
 */
export declare function consumeNonce(ctx: PluginContext, companyId: string, serviceId: string, nonce: string): Promise<boolean>;
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
export type TenantConnectResult = {
    configured: true;
    connectUrl: string;
    serviceId: string;
    channelType: string;
} | {
    configured: false;
    reason: string;
};
/**
 * Assemble a Zoho OAuth authorize URL — the single piece of URL-building logic
 * shared by the tenant entrypoint (this module) and the operator `connect-url`
 * data handler (`worker.ts`), so the two surfaces cannot drift. `state` is a
 * plain object that is JSON-encoded + URL-encoded here; the client *secret* is
 * intentionally not a parameter (it is used only server-side at token exchange).
 */
export declare function assembleAuthorizeUrl(opts: {
    dataCenter: DataCenterKey;
    clientId: string;
    callbackUrl: string;
    scopes: string;
    state: Record<string, unknown>;
}): string;
/**
 * Build the Zoho authorize URL for a company — the reusable tenant entrypoint.
 *
 * Needs no operator UI or credentials: the app-level client comes from instance
 * config, the per-company knobs from company-scoped config, and a company-scoped
 * service is auto-provisioned so the returned token is stored per company. The
 * operator `connect-url` data handler delegates here too, so both surfaces share
 * one code path.
 */
export declare function buildTenantConnectUrl(ctx: PluginContext, opts: {
    companyId: string;
    channelType?: string;
    pluginId: string;
}): Promise<TenantConnectResult>;
/**
 * Render the tenant "Connect your org" page (parameterized by companyId). Pure
 * string builder so it is trivially testable and transport-agnostic — the host
 * `onApiRequest` route serves it, and Nicole's Caddy landing gateway (PRE-789)
 * fronts it. No secrets are emitted: only the authorize URL (which contains the
 * public client id) appears.
 */
export declare function renderConnectPage(result: TenantConnectResult): string;
//# sourceMappingURL=tenant-connect.d.ts.map