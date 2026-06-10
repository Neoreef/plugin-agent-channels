/**
 * Per-service notification routing (AC-6).
 *
 * Identity mapping lives *inside each channel service's config*, not in one
 * global table — each platform has its own user ids, and a person can be mapped
 * on several channels so an alert fans out to all of them. Each service stores
 * `{ enabled, mappings: [{ paperclipUserId, channelUserId, … }] }`.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { listServices as listStoredServices } from "../../lib/service-store.js";

export type ChannelUserMapping = {
  /** Paperclip principalId (principalType === "user"). */
  paperclipUserId: string;
  /** This channel's user id (e.g. a Zoho Cliq user id). */
  channelUserId: string;
  /** Optional human label for the settings UI. */
  label?: string;
  enabled: boolean;
};

export type ServiceNotifyConfig = {
  /** Master toggle: notify users of Paperclip events on this channel. */
  enabled: boolean;
  mappings: ChannelUserMapping[];
};

const notifyKey = (serviceId: string) => `bridge.service.${serviceId}.notify`;

function notifyScope(companyId: string | undefined, serviceId: string) {
  return companyId
    ? ({ scopeKind: "company", scopeId: companyId, stateKey: notifyKey(serviceId) } as const)
    : ({ scopeKind: "instance", stateKey: notifyKey(serviceId) } as const);
}

export type ServiceRecord = { id: string; type: string; name?: string; enabled?: boolean };

/** Per-company service list (NEO-79); delegates to the shared store. */
export async function listServices(ctx: PluginContext, companyId?: string): Promise<ServiceRecord[]> {
  return await listStoredServices(ctx, companyId);
}

export async function getServiceNotify(ctx: PluginContext, serviceId: string, companyId?: string): Promise<ServiceNotifyConfig> {
  let v = (await ctx.state.get(notifyScope(companyId, serviceId))) as ServiceNotifyConfig | null;
  // Legacy bridge: fall back to instance scope for a not-yet-migrated tenant.
  if (v == null && companyId) {
    v = (await ctx.state.get(notifyScope(undefined, serviceId))) as ServiceNotifyConfig | null;
  }
  return v ?? { enabled: false, mappings: [] };
}

export async function saveServiceNotify(
  ctx: PluginContext,
  serviceId: string,
  cfg: ServiceNotifyConfig,
  companyId?: string,
): Promise<void> {
  await ctx.state.set(notifyScope(companyId, serviceId), cfg);
}

export function channelUserFor(cfg: ServiceNotifyConfig, paperclipUserId: string): string | null {
  const m = cfg.mappings.find((x) => x.paperclipUserId === paperclipUserId && x.enabled);
  return m?.channelUserId ?? null;
}

export function paperclipUserFor(cfg: ServiceNotifyConfig, channelUserId: string): string | null {
  const m = cfg.mappings.find((x) => x.channelUserId === channelUserId && x.enabled);
  return m?.paperclipUserId ?? null;
}

/**
 * Resolve a Cliq user (the button clicker) back to a Paperclip user, searching
 * every enabled Cliq service's mapping.
 */
export async function resolvePaperclipUserFromCliq(
  ctx: PluginContext,
  channelUserId: string,
  companyId?: string,
): Promise<string | null> {
  for (const svc of await listServices(ctx, companyId)) {
    if (svc.type !== "zoho-cliq") continue;
    const notify = await getServiceNotify(ctx, svc.id, companyId);
    const pid = paperclipUserFor(notify, channelUserId);
    if (pid) return pid;
  }
  return null;
}

/**
 * Paperclip company members that are users — mapping candidates for the picker.
 * (principalId only; the Cliq picker supplies names.)
 */
export async function listPaperclipUsers(
  ctx: PluginContext,
  companyId: string,
): Promise<Array<{ principalId: string; membershipRole: string | null; status: string }>> {
  const members = await ctx.access.members.list({ companyId });
  return members
    .filter((m) => m.principalType === "user")
    .map((m) => ({
      principalId: m.principalId,
      membershipRole: m.membershipRole ?? null,
      status: String(m.status),
    }));
}
