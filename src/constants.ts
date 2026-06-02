export const PLUGIN_ID = "agent-channels";
export const PLUGIN_VERSION = "0.1.0";

export const SLOT_IDS = {
  settingsPage: "agent-channels-settings-page",
} as const;

export const EXPORT_NAMES = {
  settingsPage: "AgentChannelsSettingsPage",
} as const;

export const JOB_KEYS = {
  tokenRefresh: "cliq-token-refresh",
} as const;

export const WEBHOOK_KEYS = {
  cliq: "cliq-message",
  oauthCallback: "oauth-callback",
} as const;

/** Zoho data center configuration */
export const DATA_CENTERS = {
  US: { accounts: "accounts.zoho.com", api: "www.zohoapis.com", cliq: "cliq.zoho.com" },
  EU: { accounts: "accounts.zoho.eu", api: "www.zohoapis.eu", cliq: "cliq.zoho.eu" },
  IN: { accounts: "accounts.zoho.in", api: "www.zohoapis.in", cliq: "cliq.zoho.in" },
  AU: { accounts: "accounts.zoho.com.au", api: "www.zohoapis.com.au", cliq: "cliq.zoho.com.au" },
  JP: { accounts: "accounts.zoho.jp", api: "www.zohoapis.jp", cliq: "cliq.zoho.jp" },
  CA: { accounts: "accounts.zohocloud.ca", api: "www.zohoapis.ca", cliq: "cliq.zohocloud.ca" },
} as const;

export type DataCenterKey = keyof typeof DATA_CENTERS;

/**
 * OAuth scopes for Cliq messaging — mirrors the proven Claude Agent grant.
 * Messages.CREATE/UPDATE are required to send + edit-in-place (the edit 401'd
 * without Messages.UPDATE); messageactions.* back the card buttons.
 */
export const CLIQ_SCOPES = [
  "ZohoCliq.Messages.CREATE",
  "ZohoCliq.Messages.READ",
  "ZohoCliq.Messages.UPDATE",
  "ZohoCliq.Messages.DELETE",
  "ZohoCliq.Webhooks.CREATE",
  "ZohoCliq.Webhooks.UPDATE",
  "ZohoCliq.Bots.READ",
  "ZohoCliq.messageactions.READ",
  "ZohoCliq.messageactions.CREATE",
  "ZohoCliq.messageactions.DELETE",
  "ZohoCliq.Channels.READ",
  "ZohoCliq.Chats.READ",
  "ZohoCliq.Attachments.READ",
  "ZohoCliq.StorageData.ALL",
].join(",");
