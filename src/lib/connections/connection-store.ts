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
export type ConnectionStore<
  Auth = unknown,
  Config = unknown,
  Rec extends ConnectionRecord = ConnectionRecord,
> = {
  /** Build the host {@link ScopeKey} for a state key (company- or instance-scoped). */
  scopeKey(companyId: string | undefined, stateKey: string): ScopeKey;

  // ── Registry ──────────────────────────────────────────────────────────────
  /** List a company's connections (legacy instance fallback applies). */
  list(ctx: PluginContext, companyId?: string): Promise<Rec[]>;
  /** Replace a company's connection registry. */
  save(ctx: PluginContext, records: Rec[], companyId?: string): Promise<void>;
  /** Resolve a connection's `type` by id. */
  getType(ctx: PluginContext, id: string, companyId?: string): Promise<string | undefined>;

  // ── Auth slot ─────────────────────────────────────────────────────────────
  getAuth(ctx: PluginContext, id: string, companyId?: string): Promise<Auth | null>;
  setAuth(ctx: PluginContext, id: string, auth: Auth, companyId?: string): Promise<void>;
  deleteAuth(ctx: PluginContext, id: string, companyId?: string): Promise<void>;

  // ── Config slot ───────────────────────────────────────────────────────────
  getConfig(ctx: PluginContext, id: string, companyId?: string): Promise<Config | null>;
  setConfig(ctx: PluginContext, id: string, config: Config, companyId?: string): Promise<void>;
  deleteConfig(ctx: PluginContext, id: string, companyId?: string): Promise<void>;

  // ── Arbitrary slots (notify, …) ───────────────────────────────────────────
  /** Read a named slot for a connection (legacy instance fallback applies). */
  getSlot<T>(ctx: PluginContext, id: string, slot: string, companyId?: string): Promise<T | null>;
  /** Write a named slot for a connection (company scope). */
  setSlot<T>(ctx: PluginContext, id: string, slot: string, value: T, companyId?: string): Promise<void>;
  /** Delete a named slot for a connection. */
  deleteSlot(ctx: PluginContext, id: string, slot: string, companyId?: string): Promise<void>;

  // ── Resolution ────────────────────────────────────────────────────────────
  /**
   * First connection of `type` for a company whose auth satisfies `isConnected`
   * (typically "has a refresh token"). Returns `null` when none qualifies.
   */
  findConnected(
    ctx: PluginContext,
    type: string,
    isConnected: IsConnected<Auth>,
    companyId?: string,
  ): Promise<{ id: string; auth: Auth } | null>;
};

const DEFAULT_REGISTRY_KEY = "channels.services";
const DEFAULT_NAMESPACE = "bridge.service";

/**
 * Create a per-company connection store. Each bridge plugin instantiates one
 * (usually a module-level singleton) with its own types and, if needed, its own
 * `registryKey`. Defaults reproduce Agent Channels' NEO-79 layout exactly.
 */
export function createConnectionStore<
  Auth = unknown,
  Config = unknown,
  Rec extends ConnectionRecord = ConnectionRecord,
>(options: ConnectionStoreOptions = {}): ConnectionStore<Auth, Config, Rec> {
  const registryKey = options.registryKey ?? DEFAULT_REGISTRY_KEY;
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const slotKey = (id: string, slot: string): string => `${namespace}.${id}.${slot}`;

  function scopeKey(companyId: string | undefined, stateKey: string): ScopeKey {
    return companyId
      ? { scopeKind: "company", scopeId: companyId, stateKey }
      : { scopeKind: "instance", stateKey };
  }

  /**
   * Read at company scope, falling back to the legacy instance scope when the
   * company-scoped value is absent. Only bridges legacy data; once a company
   * writes its own value the fallback no longer fires.
   */
  async function getScoped<T>(ctx: PluginContext, companyId: string | undefined, stateKey: string): Promise<T | null> {
    if (companyId) {
      const v = (await ctx.state.get(scopeKey(companyId, stateKey))) as T | null;
      if (v != null) return v;
      return (await ctx.state.get(scopeKey(undefined, stateKey))) as T | null;
    }
    return (await ctx.state.get(scopeKey(undefined, stateKey))) as T | null;
  }

  async function list(ctx: PluginContext, companyId?: string): Promise<Rec[]> {
    return (await getScoped<Rec[]>(ctx, companyId, registryKey)) ?? [];
  }

  async function save(ctx: PluginContext, records: Rec[], companyId?: string): Promise<void> {
    await ctx.state.set(scopeKey(companyId, registryKey), records);
  }

  async function getType(ctx: PluginContext, id: string, companyId?: string): Promise<string | undefined> {
    return (await list(ctx, companyId)).find((r) => r.id === id)?.type;
  }

  async function getSlot<T>(ctx: PluginContext, id: string, slot: string, companyId?: string): Promise<T | null> {
    return await getScoped<T>(ctx, companyId, slotKey(id, slot));
  }

  async function setSlot<T>(ctx: PluginContext, id: string, slot: string, value: T, companyId?: string): Promise<void> {
    await ctx.state.set(scopeKey(companyId, slotKey(id, slot)), value);
  }

  async function deleteSlot(ctx: PluginContext, id: string, slot: string, companyId?: string): Promise<void> {
    await ctx.state.delete(scopeKey(companyId, slotKey(id, slot)));
  }

  const getAuth = (ctx: PluginContext, id: string, companyId?: string) => getSlot<Auth>(ctx, id, "auth", companyId);
  const setAuth = (ctx: PluginContext, id: string, auth: Auth, companyId?: string) => setSlot<Auth>(ctx, id, "auth", auth, companyId);
  const deleteAuth = (ctx: PluginContext, id: string, companyId?: string) => deleteSlot(ctx, id, "auth", companyId);

  const getConfig = (ctx: PluginContext, id: string, companyId?: string) => getSlot<Config>(ctx, id, "config", companyId);
  const setConfig = (ctx: PluginContext, id: string, config: Config, companyId?: string) => setSlot<Config>(ctx, id, "config", config, companyId);
  const deleteConfig = (ctx: PluginContext, id: string, companyId?: string) => deleteSlot(ctx, id, "config", companyId);

  async function findConnected(
    ctx: PluginContext,
    type: string,
    isConnected: IsConnected<Auth>,
    companyId?: string,
  ): Promise<{ id: string; auth: Auth } | null> {
    for (const rec of await list(ctx, companyId)) {
      if (rec.type !== type) continue;
      const auth = await getAuth(ctx, rec.id, companyId);
      if (auth != null && isConnected(auth)) return { id: rec.id, auth };
    }
    return null;
  }

  return {
    scopeKey,
    list,
    save,
    getType,
    getAuth,
    setAuth,
    deleteAuth,
    getConfig,
    setConfig,
    deleteConfig,
    getSlot,
    setSlot,
    deleteSlot,
    findConnected,
  };
}
