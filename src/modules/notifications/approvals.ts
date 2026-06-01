/**
 * Approval notifications → Cliq cards with Approve/Deny buttons.
 *
 * Outbound: on `approval.created`, DM the company's board/owner users (those
 * with a Zoho identity mapping) a card with action buttons.
 * Inbound: the Deluge `agentChannelsButtonCallback` posts the button key back to
 * the cliq webhook; we resolve the clicker, then approve/reject via the
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
import { getBotMappings } from "../cliq/bot-mapping.js";
import { resolveZohoUser, resolvePaperclipUser, listPaperclipUsers } from "../identity/user-mapping.js";

const BTN_ACTION = { type: "invoke.function" as const, data: { name: "agentChannelsButtonCallback" } };

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

type NotifyConfig = { apiBase: string; apiToken?: string };

async function getNotifyConfig(ctx: PluginContext): Promise<NotifyConfig> {
  const cfg = (await ctx.config.get()) as Record<string, unknown>;
  return {
    apiBase: asString(cfg.paperclipApiBase) ?? "http://127.0.0.1:3100",
    apiToken: asString(cfg.paperclipApiToken),
  };
}

/** First enabled bot for the company — the sender for notifications. */
async function botForCompany(ctx: PluginContext, companyId: string): Promise<string | null> {
  const m = (await getBotMappings(ctx)).find((x) => x.companyId === companyId && x.enabled);
  return m?.botUniqueName ?? null;
}

/** DM the company's mapped owner users a card when an approval is created. */
export async function notifyApprovalCreated(
  ctx: PluginContext,
  event: PluginEvent,
): Promise<void> {
  const approvalId = event.entityId;
  const companyId = event.companyId;
  if (!approvalId || !companyId) return;

  const bot = await botForCompany(ctx, companyId);
  if (!bot) {
    ctx.logger.info(`approval.created ${approvalId}: no enabled bot for company ${companyId}, skipping`);
    return;
  }

  const { apiToken } = await getNotifyConfig(ctx);
  const detail = (event.payload ?? {}) as { type?: string; issueIds?: string[] };
  const issueRef = detail.issueIds?.length ? ` on issue ${detail.issueIds[0]}` : "";
  const requester = `${event.actorType ?? "agent"} ${event.actorId ?? ""}`.trim();

  const text =
    `🔔 *Approval requested*\n` +
    `Type: ${detail.type ?? "unknown"}${issueRef}\n` +
    `Requested by: ${requester}\n` +
    `Approval: \`${approvalId}\``;

  const buttons: CliqButton[] = apiToken
    ? [
        { label: "Approve", key: `ac:approve:${approvalId}`, type: "+", action: BTN_ACTION },
        { label: "Deny", key: `ac:reject:${approvalId}`, type: "-", action: BTN_ACTION },
      ]
    : [];
  const footer = apiToken ? "" : "\n\n_Decide in Paperclip — no API token configured for in-Cliq actions._";

  // Targets: owner members that have a Zoho mapping.
  const owners = (await listPaperclipUsers(ctx, companyId)).filter((u) => u.membershipRole === "owner");
  let delivered = 0;
  for (const o of owners) {
    const zoho = await resolveZohoUser(ctx, o.principalId);
    if (!zoho) continue;
    try {
      await sendCliqMessage(ctx, bot, zoho, text + footer, buttons);
      delivered++;
    } catch (err) {
      ctx.logger.error(`approval.created ${approvalId}: send to ${zoho} failed: ${String(err)}`);
    }
  }
  ctx.logger.info(`approval.created ${approvalId}: notified ${delivered} owner(s) via bot ${bot}`);
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
  const pcUser = await resolvePaperclipUser(ctx, senderZohoId);
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
