/**
 * Zoho Cliq API client for Paperclip plugin context.
 * Handles OAuth token refresh, bot message sending, card messages,
 * streaming edits, and rate limiting.
 *
 * Supports per-service auth (bridge.service.{serviceId}.auth/config)
 * with fallback to global zoho.auth for legacy.
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
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
export declare function downloadCliqFile(ctx: PluginContext, url: string): Promise<Buffer | null>;
export declare function sendCliqMessage(ctx: PluginContext, botName: string, userId: string, text: string, buttons?: CliqButton[]): Promise<{
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
}): Promise<{
    status: number;
    data: unknown;
}>;
export declare function deleteCliqMessage(ctx: PluginContext, chatId: string, messageId: string): Promise<void>;
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
export declare function listCliqUsers(ctx: PluginContext, serviceId?: string): Promise<CliqUser[]>;
export declare function sendCliqMessageChunked(ctx: PluginContext, botName: string, userId: string, text: string, buttons?: CliqButton[]): Promise<void>;
export declare function proactiveServiceTokenRefresh(ctx: PluginContext, serviceId: string): Promise<void>;
/** @deprecated Use proactiveServiceTokenRefresh */
export declare function proactiveTokenRefresh(ctx: PluginContext): Promise<void>;
//# sourceMappingURL=cliq-client.d.ts.map