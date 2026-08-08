/**
 * Mail channel module — SKELETON / TEMPLATE.
 *
 * Demonstrates the `ChannelModule` extension pattern: a second channel dropped in
 * and dispatched without touching the Cliq code or the worker's core dispatch.
 * It is registered in `src/channels.ts` and declares its webhook endpoint in the
 * manifest (`mail-inbound`); the registry routes deliveries here automatically.
 *
 * To turn this into a real channel, implement `handleWebhook` (parse the inbound
 * payload, resolve the target agent, run the harness, reply) the way
 * `src/modules/cliq/webhook-handler.ts` does, and — if the channel needs OAuth —
 * implement `onOAuthComplete` and emit `state.channelType: "zoho-mail"` from the
 * connect URL so the shared `oauth-callback` routes post-auth setup here.
 *
 * See CHANNELS.md for the full checklist.
 */
import type { ChannelModule } from "../../lib/types.js";
export declare const mailChannel: ChannelModule;
//# sourceMappingURL=index.d.ts.map