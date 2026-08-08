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
import { createConnectionStore } from "./connections/index.js";
/**
 * The Agent Channels connection store. Defaults reproduce the historical NEO-79
 * layout: registry at `channels.services`, slots under `bridge.service.<id>.*`.
 * Exported so sibling modules (e.g. notifications) reuse the same instance and
 * its arbitrary-slot API instead of re-deriving the scope/fallback logic.
 */
export const serviceStore = createConnectionStore();
// ─── Service registry ────────────────────────────────────────────────────────
export function listServices(ctx, companyId) {
    return serviceStore.list(ctx, companyId);
}
export function saveServices(ctx, services, companyId) {
    return serviceStore.save(ctx, services, companyId);
}
export function getServiceType(ctx, serviceId, companyId) {
    return serviceStore.getType(ctx, serviceId, companyId);
}
// ─── Per-service auth ────────────────────────────────────────────────────────
export function getServiceAuth(ctx, serviceId, companyId) {
    return serviceStore.getAuth(ctx, serviceId, companyId);
}
export function saveServiceAuth(ctx, serviceId, auth, companyId) {
    return serviceStore.setAuth(ctx, serviceId, auth, companyId);
}
export function deleteServiceAuth(ctx, serviceId, companyId) {
    return serviceStore.deleteAuth(ctx, serviceId, companyId);
}
// ─── Per-service OAuth config ────────────────────────────────────────────────
export function getServiceOAuthConfig(ctx, serviceId, companyId) {
    return serviceStore.getConfig(ctx, serviceId, companyId);
}
export function saveServiceOAuthConfig(ctx, serviceId, config, companyId) {
    return serviceStore.setConfig(ctx, serviceId, config, companyId);
}
export function deleteServiceOAuthConfig(ctx, serviceId, companyId) {
    return serviceStore.deleteConfig(ctx, serviceId, companyId);
}
// ─── Resolution helpers ──────────────────────────────────────────────────────
/**
 * Find the first connected service of a given type for a company (or globally
 * when `companyId` is omitted) — i.e. one that has a usable refresh token.
 */
export async function findConnectedService(ctx, type, companyId) {
    const found = await serviceStore.findConnected(ctx, type, (auth) => Boolean(auth.refreshToken), companyId);
    return found ? { serviceId: found.id, auth: found.auth } : null;
}
//# sourceMappingURL=service-store.js.map