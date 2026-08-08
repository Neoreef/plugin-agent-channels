/**
 * Bot-to-agent mapping.
 * Resolves a Cliq bot_unique_name to a Paperclip agent ID + company.
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { BotAgentMapping } from "../../lib/types.js";
export declare function getBotMappings(ctx: PluginContext): Promise<BotAgentMapping[]>;
export declare function saveBotMappings(ctx: PluginContext, mappings: BotAgentMapping[]): Promise<void>;
export declare function resolveBot(ctx: PluginContext, botUniqueName: string): Promise<{
    agentId: string;
    companyId: string;
} | null>;
//# sourceMappingURL=bot-mapping.d.ts.map