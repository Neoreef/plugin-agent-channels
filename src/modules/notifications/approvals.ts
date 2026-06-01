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
import { sendCliqMessage, type CliqButton } from "../../lib/cliq-client.js";
import { dispatchNotification, getNotifyConfig, ownerPrincipalIds } from "./common.js";
import { resolvePaperclipUserFromCliq } from "./service-notify.js";

// Must match the Deluge button function name shown in the settings UI guide.
const BTN_ACTION = { type: "invoke.function" as const, data: { name: "agentChannelsCallback" } };

/** DM the company's mapped owner users a card when an approval is created. */
export async function notifyApprovalCreated(
  ctx: PluginContext,
  event: PluginEvent,
): Promise<void> {
  const approvalId = event.entityId;
  const companyId = event.companyId;
  if (!approvalId || !companyId) return;

  const { apiToken } = await getNotifyConfig(ctx);
  const detail = (event.payload ?? {}) as { type?: string; issueIds?: string[] };
  const issueRef = detail.issueIds?.length ? ` on issue ${detail.issueIds[0]}` : "";
  const requester = `${event.actorType ?? "agent"} ${event.actorId ?? ""}`.trim();

  const buttons: CliqButton[] = apiToken
    ? [
        { label: "Approve", key: `ac:approve:${approvalId}`, type: "+", action: BTN_ACTION },
        { label: "Deny", key: `ac:reject:${approvalId}`, type: "-", action: BTN_ACTION },
      ]
    : [];
  const footer = apiToken ? "" : "\n\n_Decide in Paperclip — no API token configured for in-Cliq actions._";

  const text =
    `🔔 *Approval requested*\n` +
    `Type: ${detail.type ?? "unknown"}${issueRef}\n` +
    `Requested by: ${requester}\n` +
    `Approval: \`${approvalId}\`${footer}`;

  const owners = await ownerPrincipalIds(ctx, companyId);
  const delivered = await dispatchNotification(ctx, companyId, owners, text, buttons);
  ctx.logger.info(`approval.created ${approvalId}: notified ${delivered} recipient(s)`);
}

/**
 * Handle a Cliq button callback for an approval (`ac:<action>:<approvalId>`).
 * Returns true if the key was an approval action (handled), false otherwise.
 */
export async function handleApprovalButton(
  ctx: PluginContext,
  key: string,
  senderZohoId: string,
  botName: string,
): Promise<boolean> {
  const parts = key.split(":");
  if (parts[0] !== "ac") return false;
  const action = parts[1];
  const approvalId = parts[2];
  if ((action !== "approve" && action !== "reject") || !approvalId) return true;

  const { apiBase, apiToken } = await getNotifyConfig(ctx);
  if (!apiToken) {
    await sendCliqMessage(ctx, botName, senderZohoId, "Can't act from Cliq: no Paperclip API token configured.");
    return true;
  }

  // Resolve and authorize the clicker. Only mapped users may act.
  const pcUser = await resolvePaperclipUserFromCliq(ctx, senderZohoId);
  if (!pcUser) {
    await sendCliqMessage(ctx, botName, senderZohoId, "Your Cliq account isn't mapped to a Paperclip user — cannot record a decision.");
    return true;
  }

  const note = `Decided via Cliq by paperclip:${pcUser} (zoho:${senderZohoId})`;
  try {
    const res = await ctx.http.fetch(`${apiBase}/api/approvals/${approvalId}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ decisionNote: note }),
    });
    if (res.ok) {
      await sendCliqMessage(ctx, botName, senderZohoId, `✅ Approval \`${approvalId}\` ${action === "approve" ? "approved" : "denied"}.`);
    } else {
      const body = await res.text().catch(() => "");
      ctx.logger.error(`approval ${action} ${approvalId} failed: ${res.status} ${body.slice(0, 200)}`);
      await sendCliqMessage(ctx, botName, senderZohoId, `❌ Couldn't ${action} \`${approvalId}\` (HTTP ${res.status}).`);
    }
  } catch (err) {
    ctx.logger.error(`approval ${action} ${approvalId} error: ${String(err)}`);
    await sendCliqMessage(ctx, botName, senderZohoId, `❌ Error contacting Paperclip: ${String(err).slice(0, 160)}`);
  }
  return true;
}
