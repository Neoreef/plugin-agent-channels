/**
 * Per-company service storage (NEO-79 — multitenancy).
 *
 * Token storage is namespaced by company so multiple companies can each connect
 * their own Zoho org without interfering. The SDK exposes `scopeKind: "company"`,
 * so we partition `channels.services` and each service's `.auth` / `.config`
 * under `{ scopeKind: "company", scopeId: companyId }`.
 *
 * Backward compatibility: callers that pass no `companyId` (legacy global paths,
 * health checks) read/write the original `scopeKind: "instance"` keys. When a
 * `companyId` is given but that company has no company-scoped value yet, reads
 * fall back to the legacy instance value so a pre-existing single-tenant
 * deployment keeps working until it reconnects (writes always go to company
 * scope). See CHANNELS.md.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { ZohoAuthState } from "./types.js";
import type { DataCenterKey } from "../constants.js";

export type ServiceRecord = {
  id: string;
  type: string;
  name?: string;
  enabled?: boolean;
  createdAt?: string;
};

export type ServiceOAuthConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  dataCenter: DataCenterKey;
};

const SERVICES_KEY = "channels.services";
const authKey = (serviceId: string): string => `bridge.service.${serviceId}.auth`;
const configKey = (serviceId: string): string => `bridge.service.${serviceId}.config`;

/**
 * Build a ScopeKey: company-partitioned when `companyId` is present, else the
 * legacy instance-global scope.
 */
function scopeKey(companyId: string | undefined, stateKey: string) {
  return companyId
    ? ({ scopeKind: "company", scopeId: companyId, stateKey } as const)
    : ({ scopeKind: "instance", stateKey } as const);
}

/**
 * Read a value at the company scope, falling back to the legacy instance scope
 * when company-scoped state is absent. Only bridges legacy data; once a company
 * writes its own value the fallback no longer fires.
 */
async function getScoped<T>(ctx: PluginContext, companyId: string | undefined, stateKey: string): Promise<T | null> {
  if (companyId) {
    const v = (await ctx.state.get(scopeKey(companyId, stateKey))) as T | null;
    if (v != null) return v;
    // Legacy bridge: read instance-scoped value for a not-yet-migrated tenant.
    return (await ctx.state.get(scopeKey(undefined, stateKey))) as T | null;
  }
  return (await ctx.state.get(scopeKey(undefined, stateKey))) as T | null;
}

// ─── Service registry ────────────────────────────────────────────────────────

export async function listServices(ctx: PluginContext, companyId?: string): Promise<ServiceRecord[]> {
  return (await getScoped<ServiceRecord[]>(ctx, companyId, SERVICES_KEY)) ?? [];
}

export async function saveServices(ctx: PluginContext, services: ServiceRecord[], companyId?: string): Promise<void> {
  await ctx.state.set(scopeKey(companyId, SERVICES_KEY), services);
}

export async function getServiceType(ctx: PluginContext, serviceId: string, companyId?: string): Promise<string | undefined> {
  const services = await listServices(ctx, companyId);
  return services.find((s) => s.id === serviceId)?.type;
}

// ─── Per-service auth ────────────────────────────────────────────────────────

export async function getServiceAuth(ctx: PluginContext, serviceId: string, companyId?: string): Promise<ZohoAuthState | null> {
  return await getScoped<ZohoAuthState>(ctx, companyId, authKey(serviceId));
}

export async function saveServiceAuth(ctx: PluginContext, serviceId: string, auth: ZohoAuthState, companyId?: string): Promise<void> {
  await ctx.state.set(scopeKey(companyId, authKey(serviceId)), auth);
}

export async function deleteServiceAuth(ctx: PluginContext, serviceId: string, companyId?: string): Promise<void> {
  await ctx.state.delete(scopeKey(companyId, authKey(serviceId)));
}

// ─── Per-service OAuth config ────────────────────────────────────────────────

export async function getServiceOAuthConfig(ctx: PluginContext, serviceId: string, companyId?: string): Promise<ServiceOAuthConfig | null> {
  return await getScoped<ServiceOAuthConfig>(ctx, companyId, configKey(serviceId));
}

export async function saveServiceOAuthConfig(ctx: PluginContext, serviceId: string, config: ServiceOAuthConfig, companyId?: string): Promise<void> {
  await ctx.state.set(scopeKey(companyId, configKey(serviceId)), config);
}

export async function deleteServiceOAuthConfig(ctx: PluginContext, serviceId: string, companyId?: string): Promise<void> {
  await ctx.state.delete(scopeKey(companyId, configKey(serviceId)));
}

// ─── Resolution helpers ──────────────────────────────────────────────────────

/**
 * Find the first connected service of a given type for a company (or globally
 * when `companyId` is omitted) — i.e. one that has a usable refresh token.
 */
export async function findConnectedService(
  ctx: PluginContext,
  type: string,
  companyId?: string,
): Promise<{ serviceId: string; auth: ZohoAuthState } | null> {
  for (const svc of await listServices(ctx, companyId)) {
    if (svc.type !== type) continue;
    const auth = await getServiceAuth(ctx, svc.id, companyId);
    if (auth?.refreshToken) return { serviceId: svc.id, auth };
  }
  return null;
}
