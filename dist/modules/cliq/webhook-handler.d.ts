/**
 * Cliq webhook handler.
 *
 * Receives DM messages from Cliq bots, routes to Paperclip agent sessions,
 * and streams the response back via message edit-in-place.
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
export declare function handleCliqWebhook(ctx: PluginContext, rawBody: string | undefined, parsedBody: unknown): Promise<void>;
//# sourceMappingURL=webhook-handler.d.ts.map