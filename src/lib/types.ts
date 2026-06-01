import type { DataCenterKey } from "../constants.js";

/** Plugin auth state stored in ctx.state */
export type ZohoAuthState = {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  dataCenter: DataCenterKey;
  connectedUser?: string;
};

/** Bot-to-agent mapping entry */
export type BotAgentMapping = {
  botUniqueName: string;
  agentId: string;
  companyId: string;
  enabled: boolean;
};

/**
 * Zoho ↔ Paperclip user identity link. Paperclip's principalId (a user) maps to
 * a Zoho Cliq user id, so outbound items (approvals, notifications, blocked
 * issues) for a Paperclip user can be delivered to the right Cliq person.
 * Every Paperclip user has a Zoho user; not every Zoho user has a Paperclip
 * one. Stored instance-wide (a person is one identity across companies).
 */
export type UserIdentityMapping = {
  /** Paperclip principalId (principalType === "user"). */
  paperclipUserId: string;
  /** Zoho Cliq user id (the DM target). */
  zohoUserId: string;
  /** Optional human label for the settings UI. */
  displayName?: string;
  enabled: boolean;
};

/** Active query tracker — prevents concurrent sessions per user+agent */
export type ActiveQuery = {
  userId: string;
  agentId: string;
  sessionId: string;
  startedAt: number;
};
