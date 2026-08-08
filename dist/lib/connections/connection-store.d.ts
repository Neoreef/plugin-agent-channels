/**
 * Shared per-company connection store (NEO-120 — D2(a) "extract now").
 *
 * This is the reusable foundation extracted from Agent Channels' proven
 * `service-store.ts` (shipped in NEO-79). All three bridge plugins — Agent
 * Channels, Project Bridge, Knowledge Bridge — build their per-company
 * credential + config storage on top of `createConnectionStore`, so the
 * multitenant contract is byte-for-byte identical everywhere.
 *
 * ## The contract
 *
 * A "connection" is one external account a company links (a Zoho org, a project
 * portal, …). Each connection has:
 *   - a registry entry in a per-company list (`registryKey`), and
 *   - any number of named state "slots" (auth, config, notify, …) stored at
 *     `${namespace}.${connectionId}.${slot}`.
 *
 * Everything is namespaced under `{ scopeKind: "company", scopeId: companyId }`.
 *
 * ## Legacy instance-scope fallback (single-tenant safety)
 *
 * Callers that pass no `companyId` (health checks, legacy global paths)
 * read/write the original `scopeKind: "instance"` keys. When a `companyId` is
 * given but that company has no company-scoped value yet, reads fall back to the
 * legacy instance value so a pre-existing single-tenant deployment keeps working
 * until it reconnects. Writes always target company scope.
 *
 * ## OAuth state→companyId routing
 *
 * This module does not own the OAuth round-trip, but it preserves the storage
 * layout the routing depends on: the `connect-url` handler embeds `companyId` in
 * the OAuth `state` param and the callback writes the returned token back under
 * the same company namespace via `setAuth`. Because the key strings here are
 * unchanged from NEO-79, that return-path namespacing keeps working untouched.
 *
 * @module
 */
import type { PluginContext, ScopeKey } from "@paperclipai/plugin-sdk";
/**
 * Registry entry for one connection. Plugins may extend this with their own
 * fields via the `Rec` type parameter of {@link createConnectionStore}.
 */
export type ConnectionRecord = {
    /** Stable, collision-proof connection id (see NEO-40 serviceId suffixing). */
    id: string;
    /** Connection type discriminator, e.g. `"zoho-cliq"`. */
    type: string;
    name?: string;
    enabled?: boolean;
    createdAt?: string;
};
/** Predicate deciding whether an auth blob represents a usable connection. */
export type IsConnected<Auth> = (auth: Auth) => boolean;
export type ConnectionStoreOptions = {
    /**
     * State key holding the per-company connection registry array.
     * Defaults to `"channels.services"` — Agent Channels' historical key. Other
     * bridges pass their own (e.g. `"projects.connections"`).
     */
    registryKey?: string;
    /**
     * Key-namespace prefix for per-connection slots. Defaults to
     * `"bridge.service"` — deliberately shared across all bridge plugins so the
     * on-disk token layout is identical everywhere. Slot key form:
     * `${namespace}.${connectionId}.${slot}`.
     */
    namespace?: string;
};
/**
 * The public surface a bridge plugin consumes. Type parameters:
 *   - `Auth`  — the per-connection auth/token blob (e.g. `ZohoAuthState`)
 *   - `Config`— the per-connection OAuth/config blob
 *   - `Rec`   — the registry record shape (defaults to {@link ConnectionRecord})
 */
export type ConnectionStore<Auth = unknown, Config = unknown, Rec extends ConnectionRecord = ConnectionRecord> = {
    /** Build the host {@link ScopeKey} for a state key (company- or instance-scoped). */
    scopeKey(companyId: string | undefined, stateKey: string): ScopeKey;
    /** List a company's connections (legacy instance fallback applies). */
    list(ctx: PluginContext, companyId?: string): Promise<Rec[]>;
    /** Replace a company's connection registry. */
    save(ctx: PluginContext, records: Rec[], companyId?: string): Promise<void>;
    /** Resolve a connection's `type` by id. */
    getType(ctx: PluginContext, id: string, companyId?: string): Promise<string | undefined>;
    getAuth(ctx: PluginContext, id: string, companyId?: string): Promise<Auth | null>;
    setAuth(ctx: PluginContext, id: string, auth: Auth, companyId?: string): Promise<void>;
    deleteAuth(ctx: PluginContext, id: string, companyId?: string): Promise<void>;
    getConfig(ctx: PluginContext, id: string, companyId?: string): Promise<Config | null>;
    setConfig(ctx: PluginContext, id: string, config: Config, companyId?: string): Promise<void>;
    deleteConfig(ctx: PluginContext, id: string, companyId?: string): Promise<void>;
    /** Read a named slot for a connection (legacy instance fallback applies). */
    getSlot<T>(ctx: PluginContext, id: string, slot: string, companyId?: string): Promise<T | null>;
    /** Write a named slot for a connection (company scope). */
    setSlot<T>(ctx: PluginContext, id: string, slot: string, value: T, companyId?: string): Promise<void>;
    /** Delete a named slot for a connection. */
    deleteSlot(ctx: PluginContext, id: string, slot: string, companyId?: string): Promise<void>;
    /**
     * First connection of `type` for a company whose auth satisfies `isConnected`
     * (typically "has a refresh token"). Returns `null` when none qualifies.
     */
    findConnected(ctx: PluginContext, type: string, isConnected: IsConnected<Auth>, companyId?: string): Promise<{
        id: string;
        auth: Auth;
    } | null>;
};
/**
 * Create a per-company connection store. Each bridge plugin instantiates one
 * (usually a module-level singleton) with its own types and, if needed, its own
 * `registryKey`. Defaults reproduce Agent Channels' NEO-79 layout exactly.
 */
export declare function createConnectionStore<Auth = unknown, Config = unknown, Rec extends ConnectionRecord = ConnectionRecord>(options?: ConnectionStoreOptions): ConnectionStore<Auth, Config, Rec>;
//# sourceMappingURL=connection-store.d.ts.map