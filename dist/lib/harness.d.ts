/**
 * Direct harness invocation.
 *
 * Paperclip's agent APIs (`agents.sessions.sendMessage`, `agents.invoke`) both
 * route through `heartbeat.wakeup`, whose wake-prompt renderer is issue-centric
 * and drops a free-form `prompt`. A Cliq DM is a conversational turn, not an
 * issue heartbeat — so the channel plugin invokes the agent's harness directly
 * (the decided architecture), reading the harness + home + model from the
 * agent's Paperclip config and streaming the reply back.
 *
 * The plugin worker is a forked Node process, so it has child_process + fs.
 *
 * Each supported harness is one entry in HARNESS_REGISTRY describing the four
 * things that vary: which binary, how to build args (and whether the prompt
 * goes via stdin), which env keys point at the home, and how to parse output.
 * Adding a harness = adding a registry row.
 */
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { type HonchoScope } from "./honcho.js";
export interface AgentInvokeConfig {
    agentId: string;
    companyId: string;
    adapterType: string;
    /** Raw adapterConfig from Paperclip (model, provider, env, cwd, …). */
    adapterConfig: Record<string, unknown>;
}
/**
 * Incremental turn events surfaced from a harness's NDJSON stream, normalized
 * across harnesses. `text` fields carry the FULL accumulated text so far (not a
 * delta) so the draft-stream consumer can render it directly.
 */
export type HarnessEvent = {
    type: "thinking";
    text: string;
} | {
    type: "tool_use";
    toolName: string;
    description?: string;
} | {
    type: "text_delta";
    text: string;
};
export interface RunChatOptions {
    prompt: string;
    /** Called with each cleaned incremental text snapshot (full text so far). */
    onText?: (textSoFar: string) => void;
    /**
     * Called with normalized turn events (thinking/tool/answer). Claude surfaces
     * the full set via stream-json partials; other harnesses emit text_delta only
     * (answer text, no reasoning/tool cards) until their event shapes are mapped.
     */
    onEvent?: (event: HarnessEvent) => void;
    /** Resume a prior harness session for conversational continuity. */
    resumeSessionId?: string;
    /** Platform (e.g. Cliq) user id — used to scope per-user Honcho memory. */
    channelUserId?: string;
    /** Resolved Honcho scope for this turn (set internally by runAgentChat). */
    honcho?: HonchoScope;
    /** Honcho recall snippet to inject at the system level (plugin-recall). */
    memoryContext?: string;
    /** Abort signal to kill the child process. */
    signal?: AbortSignal;
    /** Hard cap on runtime (ms). Default 300_000. */
    timeoutMs?: number;
}
export interface RunChatResult {
    text: string;
    sessionId?: string;
    /** Non-zero exit or spawn failure detail, if any. */
    error?: string;
}
export interface ParsedOutput {
    text: string;
    sessionId?: string;
}
/** What a harness needs to build its command for one conversational turn. */
interface BuildArgsInput {
    prompt: string;
    model?: string;
    provider?: string;
    resumeSessionId?: string;
    /** Path to a per-turn MCP config JSON (Honcho), when the harness supports MCP. */
    mcpConfigPath?: string;
}
interface HarnessSpec {
    /** Resolve the binary (env override → PATH-resolved command name). */
    bin(): string;
    /** Absolute home/config dir the harness should run against. */
    resolveHome(adapterConfig: Record<string, unknown>, companyId: string): string;
    /** Env overrides that point the CLI at `home`. */
    homeEnv(home: string): Record<string, string>;
    /** Build argv; if `stdin` is returned, the prompt is fed via stdin not argv. */
    buildArgs(input: BuildArgsInput): {
        args: string[];
        stdin?: string;
    };
    /** Parse raw stdout → final text + session id. Tolerant of partial output. */
    parseOutput(raw: string): ParsedOutput;
    /**
     * Optional: build a stateful per-line mapper that turns this harness's NDJSON
     * events into normalized HarnessEvents. When present, runHarness feeds it each
     * complete stdout line as it arrives (for true incremental cards). When
     * absent, runHarness degrades to emitting text_delta from parseOutput.
     */
    makeStreamParser?(): (line: Record<string, unknown>, emit: (e: HarnessEvent) => void) => void;
    /**
     * Optional: a complete alternate runner replacing the default spawn+parse
     * (e.g. hermes' ACP JSON-RPC protocol, which is interactive rather than
     * one-shot). When present, runAgentChat calls this instead of runHarness.
     */
    runner?(cfg: AgentInvokeConfig, opts: RunChatOptions): Promise<RunChatResult>;
    /** This harness can load an MCP server via --mcp-config (enables Honcho memory). */
    mcp?: boolean;
    /**
     * Optional: CLI args that set the system prompt (e.g. claude
     * --append-system-prompt). When present, persona + memory instructions go to
     * the system channel and the user message stays clean; when absent, runHarness
     * folds them into the prompt instead.
     */
    systemArgs?(system: string): string[];
}
/**
 * Read an agent's persona from the bundle Paperclip already materializes at
 * `adapterConfig.instructionsRootPath` (AGENTS.md / SOUL.md / *.md). The worker
 * reads it via fs — no core change. Empty string when the agent has no bundle.
 */
export declare function readPersona(adapterConfig: Record<string, unknown>): string;
/** Hermes `-Q`: a trailing `session_id:` line + `[hermes]`/`[paperclip]` noise. */
export declare function parseHermes(raw: string): ParsedOutput;
/** Claude `--output-format stream-json`: init/assistant/result NDJSON events. */
export declare function parseClaude(raw: string): ParsedOutput;
/** Codex `exec --json`: thread.started + item.completed(agent_message) events. */
export declare function parseCodex(raw: string): ParsedOutput;
/** Gemini `--output-format stream-json`: assistant message + result events. */
export declare function parseGemini(raw: string): ParsedOutput;
export declare const HARNESS_REGISTRY: Record<string, HarnessSpec>;
/**
 * Read an agent's harness config from Paperclip and run a conversational turn
 * against it directly. Dispatches via HARNESS_REGISTRY on adapterType.
 */
export declare function runAgentChat(ctx: PluginContext, params: {
    agentId: string;
    companyId: string;
}, opts: RunChatOptions): Promise<RunChatResult>;
export {};
//# sourceMappingURL=harness.d.ts.map