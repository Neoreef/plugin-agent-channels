/**
 * Channel registry.
 *
 * Holds the `webhookKey → ChannelModule` map the worker's `onWebhook` dispatches
 * through, replacing a hard-coded `switch`. Adding a channel is a `registerChannel`
 * call (see `src/channels.ts`), not an edit to core dispatch. See CHANNELS.md.
 */
import type { ChannelModule } from "./types.js";
/**
 * Register a channel module. Throws if another module already claimed the same
 * `webhookKey` — two channels cannot share one webhook endpoint.
 */
export declare function registerChannel(module: ChannelModule): void;
/** Look up a channel by the webhook `endpointKey` of an inbound delivery. */
export declare function getChannel(webhookKey: string): ChannelModule | undefined;
/**
 * Look up a channel by its service type (matches `channels.services[].type`).
 * Used to route post-OAuth setup via `state.channelType`.
 */
export declare function getChannelByServiceType(serviceType: string): ChannelModule | undefined;
/** All registered channels (e.g. for diagnostics). */
export declare function listChannels(): ChannelModule[];
//# sourceMappingURL=channel-registry.d.ts.map