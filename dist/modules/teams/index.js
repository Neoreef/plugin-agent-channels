import { WEBHOOK_KEYS } from "../../constants.js";
export const teamsChannel = {
    webhookKey: WEBHOOK_KEYS.teams,
    getServiceType() {
        return "ms-teams";
    },
    async handleWebhook(ctx, _input) {
        ctx.logger.info("Teams channel: received inbound webhook (skeleton — no-op)");
        return { handled: false, note: "teams channel skeleton — not yet implemented" };
    },
    async onOAuthComplete(ctx, serviceId, _auth) {
        ctx.logger.info(`Teams channel: OAuth completed for service ${serviceId} (skeleton)`);
    },
};
//# sourceMappingURL=index.js.map