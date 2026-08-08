/**
 * Zoho Cliq API client for Paperclip plugin context.
 * Handles OAuth token refresh, bot message sending, card messages,
 * streaming edits, and rate limiting.
 *
 * Per-company, per-service auth (NEO-79): a `CliqScope` of `{ companyId?,
 * serviceId? }` flows through the send/refresh paths so a company's bot always
 * uses that company's own Zoho org. Storage lives in `service-store.ts` under
 * `scopeKind: "company"`, with legacy `instance`/global fallback when no
 * companyId is supplied.
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
/** Identifies which company/service a Cliq call should authenticate as. */
export type CliqScope = {
    companyId?: string;
    serviceId?: string;
};
export type CliqButton = {
    label: string;
    key: string;
    type: "+" | "-";
    hint?: string;
    action: {
        type: "invoke.function";
        data: {
            name: string;
        };
    };
};
export type CliqMessageRef = {
    chatId?: string;
    messageId?: string;
};
export declare function getChatEditCapability(chatId: string): boolean | undefined;
export declare function setChatEditCapability(chatId: string, capable: boolean): void;
/**
 * Download a Cliq file attachment by its `url` (NOT the hash id — only the url
 * works), authenticated with the OAuth token (needs ZohoCliq.Attachments.READ).
 * Returns the raw bytes, or null on failure.
 */
export declare function downloadCliqFile(ctx: PluginContext, url: string, scope?: CliqScope): Promise<Buffer | null>;
export declare function sendCliqMessage(ctx: PluginContext, botName: string, userId: string, text: string, buttons?: CliqButton[], scope?: CliqScope): Promise<{
    ref: CliqMessageRef;
}>;
export declare function sendCliqCardMessage(ctx: PluginContext, botName: string, userId: string, text: string, card: {
    theme: string;
    title?: string;
    icon?: string;
}, opts?: {
    slides?: Array<{
        type: string;
        title?: string;
        data: any;
    }>;
    bot?: {
        name: string;
        image?: string;
    };
    buttons?: CliqButton[];
    companyId?: string;
    serviceId?: string;
}): Promise<{
    status: number;
    ref: CliqMessageRef;
}>;
/**
 * Post a message into a chat by id (the chat the user DMed the bot in, from the
 * webhook's chat.id). Unlike /bots/{bot}/message, a message posted here can be
 * edited via PUT /chats/{id}/messages/{messageId} (both use Webhooks scopes).
 */
export declare function sendCliqChatMessage(ctx: PluginContext, chatId: string, text: string, opts?: {
    buttons?: CliqButton[];
    companyId?: string;
    serviceId?: string;
}): Promise<{
    status: number;
    ref: CliqMessageRef;
}>;
export declare function editCliqMessage(ctx: PluginContext, chatId: string, messageId: string, text: string, opts?: {
    card?: {
        theme: string;
        title?: string;
        icon?: string;
    };
    slides?: Array<{
        type: string;
        title?: string;
        data: any;
    }>;
    bot?: {
        name: string;
        image?: string;
    };
    buttons?: CliqButton[];
    skipRateLimit?: boolean;
    companyId?: string;
    serviceId?: string;
}): Promise<{
    status: number;
    data: unknown;
}>;
export declare function deleteCliqMessage(ctx: PluginContext, chatId: string, messageId: string, scope?: CliqScope): Promise<void>;
export type CliqUser = {
    id: string;
    name: string;
    email?: string;
};
/**
 * Best-effort list of Zoho Cliq org users (id → display name/email), for the
 * notify-mapping UI. Requests `display_name` explicitly (Cliq omits it
 * otherwise) and paginates via `next_token`. Returns [] on error/empty.
 * Requires the ZohoCliq.Users.READ / ZohoCliq.Organisation.READ scope — a
 * connection consented before those were added returns 401/"not authorised".
 */
export declare function listCliqUsers(ctx: PluginContext, scope?: CliqScope): Promise<CliqUser[]>;
export declare function sendCliqMessageChunked(ctx: PluginContext, botName: string, userId: string, text: string, buttons?: CliqButton[], scope?: CliqScope): Promise<void>;
export declare function proactiveServiceTokenRefresh(ctx: PluginContext, serviceId: string, companyId?: string): Promise<void>;
/** @deprecated Use proactiveServiceTokenRefresh */
export declare function proactiveTokenRefresh(ctx: PluginContext): Promise<void>;
//# sourceMappingURL=cliq-client.d.ts.map