/**
 * Per-service notification routing (AC-6).
 *
 * Identity mapping lives *inside each channel service's config*, not in one
 * global table — each platform has its own user ids, and a person can be mapped
 * on several channels so an alert fans out to all of them. Each service stores
 * `{ enabled, mappings: [{ paperclipUserId, channelUserId, … }] }`.
 */
import { listServices as listStoredServices, serviceStore } from "../../lib/service-store.js";
/**
 * The notify mapping is just another per-connection slot (`bridge.service.<id>.notify`),
 * so it rides the shared connection store's slot API — same company scoping and
 * legacy instance-scope fallback as auth/config, no duplicated logic (NEO-120).
 */
const NOTIFY_SLOT = "notify";
/** Per-company service list (NEO-79); delegates to the shared store. */
export async function listServices(ctx, companyId) {
    return await listStoredServices(ctx, companyId);
}
export async function getServiceNotify(ctx, serviceId, companyId) {
    // Company scope with legacy instance-scope fallback, handled by the shared store.
    const v = await serviceStore.getSlot(ctx, serviceId, NOTIFY_SLOT, companyId);
    return v ?? { enabled: false, mappings: [] };
}
export async function saveServiceNotify(ctx, serviceId, cfg, companyId) {
    await serviceStore.setSlot(ctx, serviceId, NOTIFY_SLOT, cfg, companyId);
}
export function channelUserFor(cfg, paperclipUserId) {
    const m = cfg.mappings.find((x) => x.paperclipUserId === paperclipUserId && x.enabled);
    return m?.channelUserId ?? null;
}
export function paperclipUserFor(cfg, channelUserId) {
    const m = cfg.mappings.find((x) => x.channelUserId === channelUserId && x.enabled);
    return m?.paperclipUserId ?? null;
}
/**
 * Resolve a Cliq user (the button clicker) back to a Paperclip user, searching
 * every enabled Cliq service's mapping.
 */
export async function resolvePaperclipUserFromCliq(ctx, channelUserId, companyId) {
    for (const svc of await listServices(ctx, companyId)) {
        if (svc.type !== "zoho-cliq")
            continue;
        const notify = await getServiceNotify(ctx, svc.id, companyId);
        const pid = paperclipUserFor(notify, channelUserId);
        if (pid)
            return pid;
    }
    return null;
}
/**
 * Paperclip company members that are users — mapping candidates for the picker.
 * (principalId only; the Cliq picker supplies names.)
 */
export async function listPaperclipUsers(ctx, companyId) {
    const members = await ctx.access.members.list({ companyId });
    return members
        .filter((m) => m.principalType === "user")
        .map((m) => ({
        principalId: m.principalId,
        membershipRole: m.membershipRole ?? null,
        status: String(m.status),
    }));
}
//# sourceMappingURL=service-notify.js.map