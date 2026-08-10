import { WEBHOOK_KEYS } from "../../constants.js";
export const slackChannel = {
    webhookKey: WEBHOOK_KEYS.slack,
    getServiceType() {
        return "slack";
    },
    async handleWebhook(ctx, _input) {
        ctx.logger.info("Slack channel: received inbound webhook (skeleton — no-op)");
        return { handled: false, note: "slack channel skeleton — not yet implemented" };
    },
    async onOAuthComplete(ctx, serviceId, _auth) {
        ctx.logger.info(`Slack channel: OAuth completed for service ${serviceId} (skeleton)`);
    },
};
//# sourceMappingURL=index.js.map