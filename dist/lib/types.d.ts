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
/** Active query tracker — prevents concurrent sessions per user+agent */
export type ActiveQuery = {
    userId: string;
    agentId: string;
    sessionId: string;
    startedAt: number;
};
//# sourceMappingURL=types.d.ts.map