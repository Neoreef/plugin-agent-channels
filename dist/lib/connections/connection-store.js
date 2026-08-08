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
const DEFAULT_REGISTRY_KEY = "channels.services";
const DEFAULT_NAMESPACE = "bridge.service";
/**
 * Create a per-company connection store. Each bridge plugin instantiates one
 * (usually a module-level singleton) with its own types and, if needed, its own
 * `registryKey`. Defaults reproduce Agent Channels' NEO-79 layout exactly.
 */
export function createConnectionStore(options = {}) {
    const registryKey = options.registryKey ?? DEFAULT_REGISTRY_KEY;
    const namespace = options.namespace ?? DEFAULT_NAMESPACE;
    const slotKey = (id, slot) => `${namespace}.${id}.${slot}`;
    function scopeKey(companyId, stateKey) {
        return companyId
            ? { scopeKind: "company", scopeId: companyId, stateKey }
            : { scopeKind: "instance", stateKey };
    }
    /**
     * Read at company scope, falling back to the legacy instance scope when the
     * company-scoped value is absent. Only bridges legacy data; once a company
     * writes its own value the fallback no longer fires.
     */
    async function getScoped(ctx, companyId, stateKey) {
        if (companyId) {
            const v = (await ctx.state.get(scopeKey(companyId, stateKey)));
            if (v != null)
                return v;
            return (await ctx.state.get(scopeKey(undefined, stateKey)));
        }
        return (await ctx.state.get(scopeKey(undefined, stateKey)));
    }
    async function list(ctx, companyId) {
        return (await getScoped(ctx, companyId, registryKey)) ?? [];
    }
    async function save(ctx, records, companyId) {
        await ctx.state.set(scopeKey(companyId, registryKey), records);
    }
    async function getType(ctx, id, companyId) {
        return (await list(ctx, companyId)).find((r) => r.id === id)?.type;
    }
    async function getSlot(ctx, id, slot, companyId) {
        return await getScoped(ctx, companyId, slotKey(id, slot));
    }
    async function setSlot(ctx, id, slot, value, companyId) {
        await ctx.state.set(scopeKey(companyId, slotKey(id, slot)), value);
    }
    async function deleteSlot(ctx, id, slot, companyId) {
        await ctx.state.delete(scopeKey(companyId, slotKey(id, slot)));
    }
    const getAuth = (ctx, id, companyId) => getSlot(ctx, id, "auth", companyId);
    const setAuth = (ctx, id, auth, companyId) => setSlot(ctx, id, "auth", auth, companyId);
    const deleteAuth = (ctx, id, companyId) => deleteSlot(ctx, id, "auth", companyId);
    const getConfig = (ctx, id, companyId) => getSlot(ctx, id, "config", companyId);
    const setConfig = (ctx, id, config, companyId) => setSlot(ctx, id, "config", config, companyId);
    const deleteConfig = (ctx, id, companyId) => deleteSlot(ctx, id, "config", companyId);
    async function findConnected(ctx, type, isConnected, companyId) {
        for (const rec of await list(ctx, companyId)) {
            if (rec.type !== type)
                continue;
            const auth = await getAuth(ctx, rec.id, companyId);
            if (auth != null && isConnected(auth))
                return { id: rec.id, auth };
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
//# sourceMappingURL=connection-store.js.map