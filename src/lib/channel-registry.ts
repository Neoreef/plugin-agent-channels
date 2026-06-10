/**
 * Channel registry.
 *
 * Holds the `webhookKey → ChannelModule` map the worker's `onWebhook` dispatches
 * through, replacing a hard-coded `switch`. Adding a channel is a `registerChannel`
 * call (see `src/channels.ts`), not an edit to core dispatch. See CHANNELS.md.
 */

import type { ChannelModule } from "./types.js";

const registry = new Map<string, ChannelModule>();

/**
 * Register a channel module. Throws if another module already claimed the same
 * `webhookKey` — two channels cannot share one webhook endpoint.
 */
export function registerChannel(module: ChannelModule): void {
  if (registry.has(module.webhookKey)) {
    throw new Error(
      `Channel already registered for webhookKey "${module.webhookKey}"`,
    );
  }
  registry.set(module.webhookKey, module);
}

/** Look up a channel by the webhook `endpointKey` of an inbound delivery. */
export function getChannel(webhookKey: string): ChannelModule | undefined {
  return registry.get(webhookKey);
}

/**
 * Look up a channel by its service type (matches `channels.services[].type`).
 * Used to route post-OAuth setup via `state.channelType`.
 */
export function getChannelByServiceType(
  serviceType: string,
): ChannelModule | undefined {
  for (const module of registry.values()) {
    if (module.getServiceType() === serviceType) return module;
  }
  return undefined;
}

/** All registered channels (e.g. for diagnostics). */
export function listChannels(): ChannelModule[] {
  return [...registry.values()];
}
