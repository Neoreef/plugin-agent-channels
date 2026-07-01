/**
 * Blocked-item notifications.
 *
 * On `issue.relations.updated` (mapped from the `issue.blockers.updated`
 * activity) we DM the issue's responsible person when it becomes *more* blocked
 * — i.e. blockers were added. Target: the issue's user assignee, else its user
 * creator, else the company's owners. Informational (no action buttons).
 */
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
export declare function notifyIssueBlocked(ctx: PluginContext, event: PluginEvent): Promise<void>;
//# sourceMappingURL=blocked.d.ts.map