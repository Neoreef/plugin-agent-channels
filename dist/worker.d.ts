/**
 * Agent Channels plugin worker.
 * Routes agent conversations through messaging channels (Zoho Cliq first).
 *
 * Per-service OAuth pattern — each channel service owns its own OAuth credentials
 * and auth tokens, stored in bridge.service.{serviceId}.config / .auth.
 */
import { type PaperclipPlugin } from "@paperclipai/plugin-sdk";
import "./channels.js";
declare const plugin: PaperclipPlugin;
export default plugin;
//# sourceMappingURL=worker.d.ts.map