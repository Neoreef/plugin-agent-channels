/**
 * Approval notifications → Cliq cards with Approve/Deny buttons.
 *
 * Outbound: on `approval.created`, DM the company's board/owner users (those
 * with a Zoho identity mapping) a card with action buttons.
 * Inbound: the Deluge `agentChannelsCallback` button function posts the button
 * key back to the cliq webhook; we resolve the clicker, then approve/reject via the
 * Paperclip API.
 *
 * Acting on an approval requires board auth (POST /approvals/:id/approve is
 * assertBoard), so the inbound half needs a configured Paperclip API token; the
 * target host (127.0.0.1:3100) must be on pluginHttpAllowedPrivateHosts. Without
 * a token the card is notification-only (no buttons).
 *
 * Button key format: `ac:<approve|reject>:<approvalId>` (mirrors the
 * claude-agent `cc:<action>:<id>` convention).
 */
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
/** DM the company's mapped owner users a card when an approval is created. */
export declare function notifyApprovalCreated(ctx: PluginContext, event: PluginEvent): Promise<void>;
/**
 * Handle a Cliq button callback for an approval (`ac:<action>:<approvalId>`).
 * Returns true if the key was an approval action (handled), false otherwise.
 */
export declare function handleApprovalButton(ctx: PluginContext, key: string, senderZohoId: string, botName: string): Promise<boolean>;
//# sourceMappingURL=approvals.d.ts.map