/**
 * Zoho Cliq channel module.
 *
 * Adapts the existing Cliq webhook handler to the `ChannelModule` contract so it
 * dispatches through the channel registry like any other channel. This module is
 * the reference template for adding new channels — see CHANNELS.md.
 */
import { WEBHOOK_KEYS } from "../../constants.js";
import { handleCliqWebhook } from "./webhook-handler.js";
export const cliqChannel = {
    webhookKey: WEBHOOK_KEYS.cliq,
    getServiceType() {
        return "zoho-cliq";
    },
    async handleWebhook(ctx, input) {
        await handleCliqWebhook(ctx, input.rawBody, input.parsedBody);
        return { handled: true };
    },
};
//# sourceMappingURL=index.js.map