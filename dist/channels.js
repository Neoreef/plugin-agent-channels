/**
 * Built-in channel registration.
 *
 * This is the ONE place to wire a new channel: import its module and call
 * `registerChannel`. The worker's `onWebhook` dispatch and the OAuth callback
 * route through the registry, so adding a channel never touches core code.
 *
 * Importing this module (for its side effects) populates the registry. See
 * CHANNELS.md for the full add-a-channel checklist.
 */
import { registerChannel } from "./lib/channel-registry.js";
import { cliqChannel } from "./modules/cliq/index.js";
import { mailChannel } from "./modules/mail/index.js";
registerChannel(cliqChannel);
// Skeleton second channel — proves the extension pattern (see src/modules/mail/).
registerChannel(mailChannel);
//# sourceMappingURL=channels.js.map