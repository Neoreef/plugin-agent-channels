/**
 * Blocked-item notifications.
 *
 * On `issue.relations.updated` (mapped from the `issue.blockers.updated`
 * activity) we DM the issue's responsible person when it becomes *more* blocked
 * — i.e. blockers were added. Target: the issue's user assignee, else its user
 * creator, else the company's owners. Informational (no action buttons).
 */

import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { botForCompany, dmMappedUsers, ownerPrincipalIds } from "./common.js";

export async function notifyIssueBlocked(ctx: PluginContext, event: PluginEvent): Promise<void> {
  const issueId = event.entityId;
  const companyId = event.companyId;
  if (!issueId || !companyId) return;

  const detail = (event.payload ?? {}) as {
    addedBlockedByIssueIds?: string[];
    blockedByIssueIds?: string[];
  };
  const added = detail.addedBlockedByIssueIds ?? [];
  if (added.length === 0) return; // only when newly (more) blocked — ignore unblocks

  const bot = await botForCompany(ctx, companyId);
  if (!bot) {
    ctx.logger.info(`issue blocked ${issueId}: no enabled bot for company ${companyId}, skipping`);
    return;
  }

  const issue = await ctx.issues.get(issueId, companyId);
  const ident = issue?.identifier ?? issueId;
  const title = issue?.title ?? "";
  const totalBlockers = (detail.blockedByIssueIds ?? []).length;

  // Prefer the issue's responsible human; fall back to company owners.
  const direct = [issue?.assigneeUserId, issue?.createdByUserId].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
  const usedOwners = direct.length === 0;
  const targets = usedOwners ? await ownerPrincipalIds(ctx, companyId) : direct;

  const text =
    `🚧 *Issue blocked*\n` +
    `\`${ident}\` ${title}\n` +
    `Now blocked by ${added.length} new issue(s)${totalBlockers ? ` (${totalBlockers} total)` : ""}.`;

  const delivered = await dmMappedUsers(ctx, bot, targets, text);
  ctx.logger.info(
    `issue blocked ${issueId}: notified ${delivered} ${usedOwners ? "owner(s)" : "assignee/creator"} via bot ${bot}`,
  );
}
