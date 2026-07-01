/**
 * Shared helpers for outbound notifications (approvals, blocked items, …).
 *
 * Dispatch is per-service (AC-6): an event resolves a set of Paperclip target
 * users, then each enabled channel service maps them to its own channel user
 * ids and sends — so the same alert can reach a person on Cliq, Slack, etc.
 */
import { sendCliqMessage } from "../../lib/cliq-client.js";
import { getBotMappings } from "../cliq/bot-mapping.js";
import { channelUserFor, getServiceNotify, listServices } from "./service-notify.js";
import { listPaperclipUsers } from "./service-notify.js";
export function asString(v) {
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}
export async function getNotifyConfig(ctx) {
    const cfg = (await ctx.config.get());
    return {
        apiBase: asString(cfg.paperclipApiBase) ?? "http://127.0.0.1:3100",
        apiToken: asString(cfg.paperclipApiToken),
    };
}
/** First enabled bot for the company — the Cliq sender for notifications. */
export async function botForCompany(ctx, companyId) {
    const m = (await getBotMappings(ctx)).find((x) => x.companyId === companyId && x.enabled);
    return m?.botUniqueName ?? null;
}
/** Owner-member principalIds for a company (the default notification target). */
export async function ownerPrincipalIds(ctx, companyId) {
    return (await listPaperclipUsers(ctx, companyId))
        .filter((u) => u.membershipRole === "owner")
        .map((u) => u.principalId);
}
/**
 * Fan a notification out to the given Paperclip users across every enabled
 * channel service that has notifications turned on, mapping each user to that
 * service's channel user id. Returns the total number of messages sent.
 */
export async function dispatchNotification(ctx, companyId, paperclipUserIds, text, buttons) {
    const targets = [...new Set(paperclipUserIds.filter(Boolean))];
    if (targets.length === 0)
        return 0;
    let delivered = 0;
    for (const svc of await listServices(ctx)) {
        const notify = await getServiceNotify(ctx, svc.id);
        if (!notify.enabled)
            continue;
        if (svc.type === "zoho-cliq") {
            const bot = await botForCompany(ctx, companyId);
            if (!bot) {
                ctx.logger.info(`notify: service ${svc.id} enabled but no bot for company ${companyId}`);
                continue;
            }
            for (const pid of targets) {
                const channelUserId = channelUserFor(notify, pid);
                if (!channelUserId)
                    continue;
                try {
                    await sendCliqMessage(ctx, bot, channelUserId, text, buttons);
                    delivered++;
                }
                catch (err) {
                    ctx.logger.error(`notify: cliq send to ${channelUserId} failed: ${String(err)}`);
                }
            }
        }
        // Future: slack / teams services dispatch here.
    }
    return delivered;
}
//# sourceMappingURL=common.js.map