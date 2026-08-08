export declare const PLUGIN_ID = "agent-channels";
export declare const PLUGIN_VERSION = "0.1.0";
export declare const SLOT_IDS: {
    readonly settingsPage: "agent-channels-settings-page";
};
export declare const EXPORT_NAMES: {
    readonly settingsPage: "AgentChannelsSettingsPage";
};
export declare const JOB_KEYS: {
    readonly tokenRefresh: "cliq-token-refresh";
};
export declare const WEBHOOK_KEYS: {
    readonly cliq: "cliq-message";
    readonly oauthCallback: "oauth-callback";
};
/** Zoho data center configuration */
export declare const DATA_CENTERS: {
    readonly US: {
        readonly accounts: "accounts.zoho.com";
        readonly api: "www.zohoapis.com";
        readonly cliq: "cliq.zoho.com";
    };
    readonly EU: {
        readonly accounts: "accounts.zoho.eu";
        readonly api: "www.zohoapis.eu";
        readonly cliq: "cliq.zoho.eu";
    };
    readonly IN: {
        readonly accounts: "accounts.zoho.in";
        readonly api: "www.zohoapis.in";
        readonly cliq: "cliq.zoho.in";
    };
    readonly AU: {
        readonly accounts: "accounts.zoho.com.au";
        readonly api: "www.zohoapis.com.au";
        readonly cliq: "cliq.zoho.com.au";
    };
    readonly JP: {
        readonly accounts: "accounts.zoho.jp";
        readonly api: "www.zohoapis.jp";
        readonly cliq: "cliq.zoho.jp";
    };
    readonly CA: {
        readonly accounts: "accounts.zohocloud.ca";
        readonly api: "www.zohoapis.ca";
        readonly cliq: "cliq.zohocloud.ca";
    };
};
export type DataCenterKey = keyof typeof DATA_CENTERS;
/**
 * OAuth scopes for Cliq messaging — mirrors the proven Claude Agent grant.
 * Messages.CREATE/UPDATE are required to send + edit-in-place (the edit 401'd
 * without Messages.UPDATE); messageactions.* back the card buttons.
 */
export declare const CLIQ_SCOPES: string;
//# sourceMappingURL=constants.d.ts.map