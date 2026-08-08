/**
 * Honcho id derivation — a faithful copy of paperclip-honcho/src/ids.ts so that
 * chat memory written by this plugin lands under the SAME workspace + peer ids
 * the Paperclip Honcho plugin uses for issue memory. Keep in sync with that file.
 */
import { createHash } from "node:crypto";
function toHonchoSafeSegment(value) {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}
function joinHonchoId(parts) {
    return parts
        .map((part) => toHonchoSafeSegment(part))
        .filter((part) => part.length > 0)
        .join("_");
}
export function hashId(value) {
    return createHash("sha256").update(value).digest("hex");
}
function shortStableSuffix(value) {
    return hashId(value).slice(0, 8);
}
/** Company workspace: `<CompanyName>_<sha8(companyId)>`, else `<prefix>_<companyId>`. */
export function workspaceIdForCompany(companyId, workspacePrefix, companyName) {
    if (typeof companyName === "string" && companyName.trim()) {
        return joinHonchoId([companyName, shortStableSuffix(companyId)]);
    }
    return joinHonchoId([workspacePrefix, companyId]);
}
/** Agent (assistant) peer: `agent_<name>_<sha8(agentId)>`, else `agent_<agentId>`. */
export function peerIdForAgent(agentId, agentName) {
    if (typeof agentName === "string" && agentName.trim()) {
        return joinHonchoId(["agent", agentName, shortStableSuffix(agentId)]);
    }
    return joinHonchoId(["agent", agentId]);
}
/** User peer: `user_<userId>` (userId = Paperclip user id for local users). */
export function peerIdForUser(userId) {
    return joinHonchoId(["user", userId]);
}
//# sourceMappingURL=honcho-ids.js.map