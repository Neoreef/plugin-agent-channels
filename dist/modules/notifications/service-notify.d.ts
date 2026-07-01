/**
 * Per-service notification routing (AC-6).
 *
 * Identity mapping lives *inside each channel service's config*, not in one
 * global table — each platform has its own user ids, and a person can be mapped
 * on several channels so an alert fans out to all of them. Each service stores
 * `{ enabled, mappings: [{ paperclipUserId, channelUserId, … }] }`.
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
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
export type ServiceRecord = {
    id: string;
    type: string;
    name?: string;
    enabled?: boolean;
};
export declare function listServices(ctx: PluginContext): Promise<ServiceRecord[]>;
export declare function getServiceNotify(ctx: PluginContext, serviceId: string): Promise<ServiceNotifyConfig>;
export declare function saveServiceNotify(ctx: PluginContext, serviceId: string, cfg: ServiceNotifyConfig): Promise<void>;
export declare function channelUserFor(cfg: ServiceNotifyConfig, paperclipUserId: string): string | null;
export declare function paperclipUserFor(cfg: ServiceNotifyConfig, channelUserId: string): string | null;
/**
 * Resolve a Cliq user (the button clicker) back to a Paperclip user, searching
 * every enabled Cliq service's mapping.
 */
export declare function resolvePaperclipUserFromCliq(ctx: PluginContext, channelUserId: string): Promise<string | null>;
/**
 * Paperclip company members that are users — mapping candidates for the picker.
 * (principalId only; the Cliq picker supplies names.)
 */
export declare function listPaperclipUsers(ctx: PluginContext, companyId: string): Promise<Array<{
    principalId: string;
    membershipRole: string | null;
    status: string;
}>>;
//# sourceMappingURL=service-notify.d.ts.map