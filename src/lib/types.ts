import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import type { DataCenterKey } from "../constants.js";

/**
 * Outcome of a channel module handling an inbound webhook.
 *
 * `handled: false` means the module received the event but did not act on it
 * (e.g. an unrecognized event type), letting the dispatcher log/diagnose
 * without throwing. `note` is a short human-readable reason for logs.
 */
export type WebhookResult = {
  handled: boolean;
  note?: string;
};

/**
 * Contract every channel module must satisfy. A channel (Cliq, Mail, Zoho Desk,
 * an external bridge, …) is registered once in the channel registry keyed by its
 * `webhookKey`; the worker's `onWebhook` dispatches to it without any core edit.
 *
 * This is the extension point: to add a channel, implement `ChannelModule`,
 * register it (see `src/channels.ts`), and declare its webhook endpoint in the
 * manifest — no changes to shared infrastructure. See CHANNELS.md.
 */
export interface ChannelModule {
  /**
   * The manifest webhook `endpointKey` this channel listens on (e.g.
   * `"cliq-message"`). Must be unique across registered channels and must match
   * a `webhooks[].endpointKey` entry in the manifest.
   */
  readonly webhookKey: string;

  /**
   * Handle one inbound webhook delivery for this channel. Implementations should
   * not throw for routine "not for me / unrecognized" cases — return
   * `{ handled: false, note }` instead so the dispatcher can log it.
   *
   * `companyId` is supplied when the delivery is already scoped to a company
   * (otherwise the module resolves it from its own mappings).
   */
  handleWebhook(
    ctx: PluginContext,
    input: PluginWebhookInput,
    companyId?: string,
  ): Promise<WebhookResult>;

  /**
   * The service type identifier for this channel — matches the `type` field of
   * entries in the `channels.services` instance-state registry (e.g.
   * `"zoho-cliq"`). Used to route post-OAuth setup via `state.channelType`.
   */
  getServiceType(): string;

  /**
   * Optional post-OAuth hook. Channels that reuse the shared `oauth-callback`
   * endpoint are dispatched here after the token exchange succeeds, routed by
   * `state.channelType`. Use it for per-channel setup (registering bots,
   * subscribing to events, etc.). Channels without OAuth omit it.
   *
   * `companyId` is the company that owns this connection (NEO-79), present when
   * the connect flow was scoped to a company; omitted for legacy global setups.
   */
  onOAuthComplete?(
    ctx: PluginContext,
    serviceId: string,
    auth: ZohoAuthState,
    companyId?: string,
  ): Promise<void>;
}

/** Plugin auth state stored in ctx.state */
export type ZohoAuthState = {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  dataCenter: DataCenterKey;
  connectedUser?: string;
};

/** Bot-to-agent mapping entry */
export type BotAgentMapping = {
  botUniqueName: string;
  agentId: string;
  companyId: string;
  enabled: boolean;
};

/** Active query tracker — prevents concurrent sessions per user+agent */
export type ActiveQuery = {
  userId: string;
  agentId: string;
  sessionId: string;
  startedAt: number;
};
