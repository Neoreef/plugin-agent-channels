/**
 * Zoho ↔ Paperclip user identity mapping.
 *
 * The routing book for outbound delivery: given a Paperclip user (issue
 * assignee/creator, approval requester) find the Zoho Cliq user to DM, and
 * vice-versa for inbound button actions. Stored instance-wide in ctx.state.
 */

import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { UserIdentityMapping } from "../../lib/types.js";

const STATE_KEY = "identity.userMappings";

export async function getUserMappings(ctx: PluginContext): Promise<UserIdentityMapping[]> {
  const m = (await ctx.state.get({
    scopeKind: "instance",
    stateKey: STATE_KEY,
  })) as UserIdentityMapping[] | null;
  return m ?? [];
}

export async function saveUserMappings(
  ctx: PluginContext,
  mappings: UserIdentityMapping[],
): Promise<void> {
  await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEY }, mappings);
}

/** Paperclip user → Zoho Cliq user id (for outbound delivery). */
export async function resolveZohoUser(
  ctx: PluginContext,
  paperclipUserId: string,
): Promise<string | null> {
  const m = (await getUserMappings(ctx)).find(
    (x) => x.paperclipUserId === paperclipUserId && x.enabled,
  );
  return m?.zohoUserId ?? null;
}

/** Zoho Cliq user → Paperclip principalId (for inbound button actions). */
export async function resolvePaperclipUser(
  ctx: PluginContext,
  zohoUserId: string,
): Promise<string | null> {
  const m = (await getUserMappings(ctx)).find(
    (x) => x.zohoUserId === zohoUserId && x.enabled,
  );
  return m?.paperclipUserId ?? null;
}

/**
 * Paperclip company members that are users (principalType === "user"), as
 * mapping candidates. The member record exposes principalId but not name/email,
 * so the settings UI pairs these with Zoho users (which do carry names).
 */
export async function listPaperclipUsers(
  ctx: PluginContext,
  companyId: string,
): Promise<Array<{ principalId: string; membershipRole: string | null; status: string }>> {
  const members = await ctx.access.members.list({ companyId });
  return members
    .filter((m) => m.principalType === "user")
    .map((m) => ({
      principalId: m.principalId,
      membershipRole: m.membershipRole ?? null,
      status: String(m.status),
    }));
}
