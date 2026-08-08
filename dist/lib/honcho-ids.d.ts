/**
 * Honcho id derivation — a faithful copy of paperclip-honcho/src/ids.ts so that
 * chat memory written by this plugin lands under the SAME workspace + peer ids
 * the Paperclip Honcho plugin uses for issue memory. Keep in sync with that file.
 */
export declare function hashId(value: string): string;
/** Company workspace: `<CompanyName>_<sha8(companyId)>`, else `<prefix>_<companyId>`. */
export declare function workspaceIdForCompany(companyId: string, workspacePrefix: string, companyName?: string | null): string;
/** Agent (assistant) peer: `agent_<name>_<sha8(agentId)>`, else `agent_<agentId>`. */
export declare function peerIdForAgent(agentId: string, agentName?: string | null): string;
/** User peer: `user_<userId>` (userId = Paperclip user id for local users). */
export declare function peerIdForUser(userId: string): string;
//# sourceMappingURL=honcho-ids.d.ts.map