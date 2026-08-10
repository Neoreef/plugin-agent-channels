import { WEBHOOK_KEYS } from "../../constants.js";
export const googleChatChannel = {
    webhookKey: WEBHOOK_KEYS.googleChat,
    getServiceType() {
        return "google-chat";
    },
    async handleWebhook(ctx, _input) {
        ctx.logger.info("Google Chat channel: received inbound webhook (skeleton — no-op)");
        return { handled: false, note: "google-chat channel skeleton — not yet implemented" };
    },
    async onOAuthComplete(ctx, serviceId, _auth) {
        ctx.logger.info(`Google Chat channel: OAuth completed for service ${serviceId} (skeleton)`);
    },
};
//# sourceMappingURL=index.js.map