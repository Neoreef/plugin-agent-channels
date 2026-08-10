/**
 * Per-company service storage (NEO-79 multitenancy → NEO-120 extraction).
 *
 * This is now the **reference consumer** of the shared connection store
 * (`src/lib/connections/`). The generic scope-keyed, legacy-fallback storage
 * logic lives there; this file is the thin Agent-Channels binding that fixes the
 * concrete types (`ZohoAuthState`, `ServiceOAuthConfig`) and preserves the exact
 * public function surface the rest of the plugin already imports — so worker.ts,
 * cliq-client.ts, the notify module, and the isolation suite are untouched.
 *
 * Storage layout is byte-for-byte identical to NEO-79 (same state keys, same
 * `{ scopeKind: "company", scopeId: companyId }` partitioning, same legacy
 * instance-scope fallback). See CHANNELS.md.
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { ZohoAuthState } from "./types.js";
import type { DataCenterKey } from "../constants.js";
import { type ConnectionRecord } from "./connections/index.js";
/** A connected channel service (Cliq, Mail, …). */
export type ServiceRecord = ConnectionRecord;
export type ServiceOAuthConfig = {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
    dataCenter: DataCenterKey;
};
/**
 * The Agent Channels connection store. Defaults reproduce the historical NEO-79
 * layout: registry at `channels.services`, slots under `bridge.service.<id>.*`.
 * Exported so sibling modules (e.g. notifications) reuse the same instance and
 * its arbitrary-slot API instead of re-deriving the scope/fallback logic.
 */
export declare const serviceStore: import("./connections/connection-store.js").ConnectionStore<ZohoAuthState, ServiceOAuthConfig, ConnectionRecord>;
export declare function listServices(ctx: PluginContext, companyId?: string): Promise<ServiceRecord[]>;
export declare function saveServices(ctx: PluginContext, services: ServiceRecord[], companyId?: string): Promise<void>;
export declare function getServiceType(ctx: PluginContext, serviceId: string, companyId?: string): Promise<string | undefined>;
export declare function getServiceAuth(ctx: PluginContext, serviceId: string, companyId?: string): Promise<ZohoAuthState | null>;
export declare function saveServiceAuth(ctx: PluginContext, serviceId: string, auth: ZohoAuthState, companyId?: string): Promise<void>;
export declare function deleteServiceAuth(ctx: PluginContext, serviceId: string, companyId?: string): Promise<void>;
export declare function getServiceOAuthConfig(ctx: PluginContext, serviceId: string, companyId?: string): Promise<ServiceOAuthConfig | null>;
export declare function saveServiceOAuthConfig(ctx: PluginContext, serviceId: string, config: ServiceOAuthConfig, companyId?: string): Promise<void>;
export declare function deleteServiceOAuthConfig(ctx: PluginContext, serviceId: string, companyId?: string): Promise<void>;
/**
 * Find the first connected service of a given type for a company (or globally
 * when `companyId` is omitted) — i.e. one that has a usable refresh token.
 */
export declare function findConnectedService(ctx: PluginContext, type: string, companyId?: string): Promise<{
    serviceId: string;
    auth: ZohoAuthState;
} | null>;
//# sourceMappingURL=service-store.d.ts.map