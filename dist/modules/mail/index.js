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
import { WEBHOOK_KEYS } from "../../constants.js";
export const mailChannel = {
    webhookKey: WEBHOOK_KEYS.mail,
    getServiceType() {
        return "zoho-mail";
    },
    async handleWebhook(ctx, _input) {
        // Skeleton: acknowledge receipt but do not act yet. A real implementation
        // would parse the message, route to a Paperclip agent session, and reply.
        ctx.logger.info("Mail channel: received inbound webhook (skeleton — no-op)");
        return { handled: false, note: "mail channel skeleton — not yet implemented" };
    },
    async onOAuthComplete(ctx, serviceId, _auth) {
        // Skeleton post-OAuth hook — runs when state.channelType === "zoho-mail".
        ctx.logger.info(`Mail channel: OAuth completed for service ${serviceId} (skeleton)`);
    },
};
//# sourceMappingURL=index.js.map