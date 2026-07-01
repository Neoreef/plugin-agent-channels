/**
 * Shared helpers for outbound notifications (approvals, blocked items, …).
 *
 * Dispatch is per-service (AC-6): an event resolves a set of Paperclip target
 * users, then each enabled channel service maps them to its own channel user
 * ids and sends — so the same alert can reach a person on Cliq, Slack, etc.
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { type CliqButton } from "../../lib/cliq-client.js";
export declare function asString(v: unknown): string | undefined;
export type NotifyApiConfig = {
    apiBase: string;
    apiToken?: string;
};
export declare function getNotifyConfig(ctx: PluginContext): Promise<NotifyApiConfig>;
/** First enabled bot for the company — the Cliq sender for notifications. */
export declare function botForCompany(ctx: PluginContext, companyId: string): Promise<string | null>;
/** Owner-member principalIds for a company (the default notification target). */
export declare function ownerPrincipalIds(ctx: PluginContext, companyId: string): Promise<string[]>;
/**
 * Fan a notification out to the given Paperclip users across every enabled
 * channel service that has notifications turned on, mapping each user to that
 * service's channel user id. Returns the total number of messages sent.
 */
export declare function dispatchNotification(ctx: PluginContext, companyId: string, paperclipUserIds: string[], text: string, buttons?: CliqButton[]): Promise<number>;
//# sourceMappingURL=common.d.ts.map