/**
 * Bot-to-agent mapping.
 * Resolves a Cliq bot_unique_name to a Paperclip agent ID + company.
 */
const STATE_KEY = "cliq.botMappings";
export async function getBotMappings(ctx) {
    const mappings = (await ctx.state.get({
        scopeKind: "instance",
        stateKey: STATE_KEY,
    }));
    return mappings ?? [];
}
export async function saveBotMappings(ctx, mappings) {
    await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEY }, mappings);
}
export async function resolveBot(ctx, botUniqueName) {
    const mappings = await getBotMappings(ctx);
    const mapping = mappings.find((m) => m.botUniqueName === botUniqueName && m.enabled);
    if (!mapping)
        return null;
    return { agentId: mapping.agentId, companyId: mapping.companyId };
}
//# sourceMappingURL=bot-mapping.js.map