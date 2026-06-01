/**
 * Shared helpers for outbound Cliq notifications (approvals, blocked items, …).
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { sendCliqMessage, type CliqButton } from "../../lib/cliq-client.js";
import { getBotMappings } from "../cliq/bot-mapping.js";
import { resolveZohoUser, listPaperclipUsers } from "../identity/user-mapping.js";

export function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export type NotifyConfig = { apiBase: string; apiToken?: string };

export async function getNotifyConfig(ctx: PluginContext): Promise<NotifyConfig> {
  const cfg = (await ctx.config.get()) as Record<string, unknown>;
  return {
    apiBase: asString(cfg.paperclipApiBase) ?? "http://127.0.0.1:3100",
    apiToken: asString(cfg.paperclipApiToken),
  };
}

/** First enabled bot for the company — the sender for notifications. */
export async function botForCompany(ctx: PluginContext, companyId: string): Promise<string | null> {
  const m = (await getBotMappings(ctx)).find((x) => x.companyId === companyId && x.enabled);
  return m?.botUniqueName ?? null;
}

/** Owner-member principalIds for a company (the board fallback target). */
export async function ownerPrincipalIds(ctx: PluginContext, companyId: string): Promise<string[]> {
  return (await listPaperclipUsers(ctx, companyId))
    .filter((u) => u.membershipRole === "owner")
    .map((u) => u.principalId);
}

/**
 * DM the same message to each Paperclip user that has a Zoho mapping. Returns
 * the count actually delivered. Duplicate principals and unmapped users are
 * skipped.
 */
export async function dmMappedUsers(
  ctx: PluginContext,
  bot: string,
  paperclipUserIds: string[],
  text: string,
  buttons?: CliqButton[],
): Promise<number> {
  const seen = new Set<string>();
  let delivered = 0;
  for (const pid of paperclipUserIds) {
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    const zoho = await resolveZohoUser(ctx, pid);
    if (!zoho) continue;
    try {
      await sendCliqMessage(ctx, bot, zoho, text, buttons);
      delivered++;
    } catch (err) {
      ctx.logger.error(`notify: send to ${zoho} failed: ${String(err)}`);
    }
  }
  return delivered;
}
