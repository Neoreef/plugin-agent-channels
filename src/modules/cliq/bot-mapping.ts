/**
 * Bot-to-agent mapping.
 * Resolves a Cliq bot_unique_name to a Paperclip agent ID + company.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { BotAgentMapping } from "../../lib/types.js";

const STATE_KEY = "cliq.botMappings";

export async function getBotMappings(ctx: PluginContext): Promise<BotAgentMapping[]> {
  const mappings = (await ctx.state.get({
    scopeKind: "instance",
    stateKey: STATE_KEY,
  })) as BotAgentMapping[] | null;
  return mappings ?? [];
}

export async function saveBotMappings(ctx: PluginContext, mappings: BotAgentMapping[]): Promise<void> {
  await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEY }, mappings);
}

export async function resolveBot(
  ctx: PluginContext,
  botUniqueName: string,
): Promise<{ agentId: string; companyId: string } | null> {
  const mappings = await getBotMappings(ctx);
  const mapping = mappings.find((m) => m.botUniqueName === botUniqueName && m.enabled);
  if (!mapping) return null;
  return { agentId: mapping.agentId, companyId: mapping.companyId };
}
