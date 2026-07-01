/**
 * Per-service notification routing (AC-6).
 *
 * Identity mapping lives *inside each channel service's config*, not in one
 * global table — each platform has its own user ids, and a person can be mapped
 * on several channels so an alert fans out to all of them. Each service stores
 * `{ enabled, mappings: [{ paperclipUserId, channelUserId, … }] }`.
 */
const notifyKey = (serviceId) => `bridge.service.${serviceId}.notify`;
export async function listServices(ctx) {
    return (await ctx.state.get({ scopeKind: "instance", stateKey: "channels.services" })) ?? [];
}
export async function getServiceNotify(ctx, serviceId) {
    const v = (await ctx.state.get({ scopeKind: "instance", stateKey: notifyKey(serviceId) }));
    return v ?? { enabled: false, mappings: [] };
}
export async function saveServiceNotify(ctx, serviceId, cfg) {
    await ctx.state.set({ scopeKind: "instance", stateKey: notifyKey(serviceId) }, cfg);
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
export async function resolvePaperclipUserFromCliq(ctx, channelUserId) {
    for (const svc of await listServices(ctx)) {
        if (svc.type !== "zoho-cliq")
            continue;
        const notify = await getServiceNotify(ctx, svc.id);
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