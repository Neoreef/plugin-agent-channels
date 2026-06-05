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

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import {
  honchoMcpToolsEnabled,
  writeHonchoMcpConfig,
  honchoInstructions,
  type HonchoScope,
} from "./honcho.js";

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
export type HarnessEvent =
  | { type: "thinking"; text: string }
  | { type: "tool_use"; toolName: string; description?: string }
  | { type: "text_delta"; text: string };

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
  buildArgs(input: BuildArgsInput): { args: string[]; stdin?: string };
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

// ── helpers ────────────────────────────────────────────────────────────────

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Raw string passthrough — NEVER trims. Use for accumulating streaming deltas/
 * chunks: trimming each piece drops the spaces that fall on chunk boundaries
 * ("I'll run"+"that" → "runthat"). asString() is for whole fields, not deltas.
 */
function rawStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function binFor(envVar: string, fallback: string): string {
  return asString(process.env[envVar]) ?? fallback;
}

function envHome(adapterConfig: Record<string, unknown>, ...keys: string[]): string | undefined {
  const env = (adapterConfig.env as Record<string, unknown> | undefined) ?? {};
  for (const k of keys) {
    const v = asString(env[k]);
    if (v) return path.resolve(v);
  }
  return undefined;
}

/**
 * Paperclip-managed per-company home, mirroring the hermes-local adapter's
 * `resolveHermesHome` fallback. The map-time provisioner overrides this by
 * setting adapterConfig.env.{HARNESS}_HOME to a per-agent home.
 */
function managedCompanyHome(companyId: string, leaf: string): string {
  const paperclipHome =
    asString(process.env.PAPERCLIP_HOME) ?? path.resolve(os.homedir(), ".paperclip");
  const instanceId = asString(process.env.PAPERCLIP_INSTANCE_ID) ?? "default";
  return path.resolve(paperclipHome, "instances", instanceId, "companies", companyId, leaf);
}

/**
 * Read an agent's persona from the bundle Paperclip already materializes at
 * `adapterConfig.instructionsRootPath` (AGENTS.md / SOUL.md / *.md). The worker
 * reads it via fs — no core change. Empty string when the agent has no bundle.
 */
export function readPersona(adapterConfig: Record<string, unknown>): string {
  const root = asString(adapterConfig.instructionsRootPath);
  if (!root) return "";
  let files: string[];
  try {
    files = readdirSync(root).filter((f) => f.toLowerCase().endsWith(".md")).sort();
  } catch {
    return "";
  }
  // SOUL/AGENTS first when present, then the rest, for a stable persona order.
  const rank = (f: string) => (/soul/i.test(f) ? 0 : /agents?/i.test(f) ? 1 : 2);
  files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const parts: string[] = [];
  for (const f of files) {
    try {
      const body = readFileSync(path.join(root, f), "utf8").trim();
      if (body) parts.push(body);
    } catch { /* skip unreadable file */ }
  }
  return parts.join("\n\n").trim();
}

/** Frame persona (+ optional extra system instructions) + the user's message. */
function composePrompt(persona: string, userPrompt: string, extra?: string): string {
  const system = [persona, extra].filter((s) => s && s.trim()).join("\n\n");
  if (!system) return userPrompt;
  return [
    "You are operating under the following agent instructions. Stay in character and follow them for this conversation.",
    "",
    "<agent_instructions>",
    system,
    "</agent_instructions>",
    "",
    "Respond to this message:",
    userPrompt,
  ].join("\n");
}

/** Parse newline-delimited JSON, skipping blank/incomplete/invalid lines. */
function parseJsonLines(raw: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object") out.push(v as Record<string, unknown>);
    } catch {
      // partial trailing line mid-stream, or non-JSON noise — skip
    }
  }
  return out;
}

// ── per-harness output parsers ───────────────────────────────────────────────

/** Hermes `-Q`: a trailing `session_id:` line + `[hermes]`/`[paperclip]` noise. */
export function parseHermes(raw: string): ParsedOutput {
  let sessionId: string | undefined;
  const kept: string[] = [];
  for (const line of raw.split("\n")) {
    const sid = line.match(/^\s*session_id:\s*(\S+)\s*$/i);
    if (sid) { sessionId = sid[1]; continue; }
    if (/^\s*\[(hermes|paperclip)\]/i.test(line)) continue;
    kept.push(line);
  }
  return { text: kept.join("\n").trim(), sessionId };
}

/** Claude `--output-format stream-json`: init/assistant/result NDJSON events. */
export function parseClaude(raw: string): ParsedOutput {
  let sessionId: string | undefined;
  let result: string | undefined;
  const assistantText: string[] = [];
  for (const e of parseJsonLines(raw)) {
    const sid = asString(e.session_id);
    if (sid) sessionId = sid;
    const type = asString(e.type);
    if (type === "assistant") {
      const msg = (e.message as Record<string, unknown> | undefined) ?? {};
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const part of content) {
        const p = part as Record<string, unknown>;
        if (asString(p.type) === "text") {
          const t = asString(p.text);
          if (t) assistantText.push(t);
        }
      }
    } else if (type === "result") {
      const r = asString(e.result);
      if (r) result = r;
    }
  }
  return { text: (result ?? assistantText.join("")).trim(), sessionId };
}

/**
 * Render a tool call's input into a short, human-readable line for the tool
 * card — the salient argument per tool (path, command, pattern, url), falling
 * back to a truncated JSON blob. Mirrors claude-agent's tool slide.
 */
function summarizeToolInput(toolName: string, input: Record<string, unknown>): string | undefined {
  const s = (k: string): string | undefined => asString(input[k]);
  const n = toolName.toLowerCase();
  const path = s("file_path") ?? s("path") ?? s("notebook_path");
  if (path) return path;
  if (n.includes("bash") || n.includes("exec") || n.includes("shell")) return s("command");
  if (n.includes("glob") || n.includes("grep") || n.includes("search")) {
    return [s("pattern"), s("path") ? `in ${s("path")}` : undefined].filter(Boolean).join(" ");
  }
  if (n.includes("fetch") || n.includes("web")) return s("url") ?? s("query") ?? s("prompt");
  if (n.includes("task") || n.includes("agent")) return s("description") ?? s("prompt");
  // Generic: first non-empty string value, else a compact JSON snippet.
  for (const v of Object.values(input)) {
    const t = asString(v);
    if (t) return t;
  }
  try {
    const j = JSON.stringify(input);
    return j && j !== "{}" ? j : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Stateful mapper for Claude `--include-partial-messages` stream-json. The CLI
 * wraps raw Anthropic SSE events as `{type:"stream_event", event:{...}}`:
 *  - content_block_start{content_block.type:"tool_use", name} → tool_use (name)
 *  - content_block_delta{delta.type:"input_json_delta", partial_json} accumulates
 *    the tool input; on content_block_stop we re-emit tool_use with a description
 *  - content_block_delta{delta.type:"text_delta", text}       → text_delta
 *  - content_block_delta{delta.type:"thinking_delta", thinking} → thinking
 * We accumulate answer/thinking text and emit the FULL running text each time,
 * matching the draft-stream's update() contract. Message-level `assistant`
 * events are ignored here (they'd double-count the text); parseClaude still
 * derives the authoritative final text from them.
 */
function makeClaudeStreamParser(): (line: Record<string, unknown>, emit: (e: HarnessEvent) => void) => void {
  let answer = "";
  let thinking = "";
  // Per-block-index tool state: name + accumulating input_json_delta buffer.
  const tools = new Map<number, { name: string; json: string }>();
  return (e, emit) => {
    if (asString(e.type) !== "stream_event") return;
    const ev = (e.event as Record<string, unknown> | undefined) ?? {};
    const evType = asString(ev.type);
    const index = typeof ev.index === "number" ? ev.index : -1;
    if (evType === "content_block_start") {
      const cb = (ev.content_block as Record<string, unknown> | undefined) ?? {};
      if (asString(cb.type) === "tool_use") {
        const name = asString(cb.name) ?? "tool";
        tools.set(index, { name, json: "" });
        emit({ type: "tool_use", toolName: name });
      }
    } else if (evType === "content_block_stop") {
      const tool = tools.get(index);
      if (tool) {
        tools.delete(index);
        let description: string | undefined;
        try {
          const parsed = tool.json ? (JSON.parse(tool.json) as Record<string, unknown>) : {};
          description = summarizeToolInput(tool.name, parsed);
        } catch { /* incomplete JSON — skip description */ }
        emit({ type: "tool_use", toolName: tool.name, description });
      }
    } else if (evType === "content_block_delta") {
      const d = (ev.delta as Record<string, unknown> | undefined) ?? {};
      const dt = asString(d.type);
      if (dt === "text_delta") {
        answer += rawStr(d.text);
        if (answer) emit({ type: "text_delta", text: answer });
      } else if (dt === "thinking_delta") {
        thinking += rawStr(d.thinking);
        if (thinking) emit({ type: "thinking", text: thinking });
      } else if (dt === "input_json_delta") {
        const tool = tools.get(index);
        if (tool) tool.json += asString(d.partial_json) ?? "";
      }
    }
  };
}

/**
 * Gemini `--output-format stream-json` mapper. Events are whole messages, not
 * token deltas: `message`{role,content} (assistant text — accumulate),
 * `tool_use`{tool_name,parameters} → tool_use. init/tool_result/result ignored.
 */
function makeGeminiStreamParser(): (line: Record<string, unknown>, emit: (e: HarnessEvent) => void) => void {
  let answer = "";
  return (e, emit) => {
    const type = asString(e.type);
    if (type === "message" && asString(e.role) !== "user") {
      const t = textOfContent(e.content) || (asString(e.text) ?? "");
      if (t) { answer += t; emit({ type: "text_delta", text: answer }); }
    } else if (type === "tool_use") {
      const name = asString(e.tool_name) ?? "tool";
      const params = e.parameters;
      const desc = params && typeof params === "object"
        ? summarizeToolInput(name, params as Record<string, unknown>)
        : undefined;
      emit({ type: "tool_use", toolName: name, description: desc });
    }
  };
}

/**
 * Codex `exec --json` mapper (best-effort; no local codex CLI to verify live).
 * item.{started,updated,completed} carry an item by type: agent_message (answer
 * — full text), reasoning (thinking), command_execution/*_call (tool).
 */
function makeCodexStreamParser(): (line: Record<string, unknown>, emit: (e: HarnessEvent) => void) => void {
  let answer = "";
  return (e, emit) => {
    const type = asString(e.type);
    if (!type || !type.startsWith("item")) return;
    const item = (e.item as Record<string, unknown> | undefined) ?? {};
    const itype = asString(item.type);
    if (itype === "agent_message") {
      const t = asString(item.text);
      if (t) { answer = t; emit({ type: "text_delta", text: answer }); }
    } else if (itype === "reasoning") {
      const t = asString(item.text);
      if (t) emit({ type: "thinking", text: t });
    } else if (itype && (itype.includes("command") || itype.includes("call") || itype.includes("exec"))) {
      const name = itype.includes("command") ? "Shell" : (asString(item.name) ?? "tool");
      emit({ type: "tool_use", toolName: name, description: asString(item.command) ?? asString(item.name) });
    }
  };
}

/** Codex `exec --json`: thread.started + item.completed(agent_message) events. */
export function parseCodex(raw: string): ParsedOutput {
  let sessionId: string | undefined;
  let finalMessage: string | undefined;
  for (const e of parseJsonLines(raw)) {
    const type = asString(e.type);
    if (type === "thread.started") {
      sessionId = asString(e.thread_id) ?? sessionId;
    } else if (type === "item.completed") {
      const item = (e.item as Record<string, unknown> | undefined) ?? {};
      if (asString(item.type) === "agent_message") {
        const t = asString(item.text);
        if (t) finalMessage = t;
      }
    }
  }
  return { text: (finalMessage ?? "").trim(), sessionId };
}

/** Gemini `--output-format stream-json`: assistant message + result events. */
export function parseGemini(raw: string): ParsedOutput {
  let sessionId: string | undefined;
  const messages: string[] = [];
  for (const e of parseJsonLines(raw)) {
    sessionId =
      asString(e.session_id) ?? asString(e.sessionId) ??
      asString(e.checkpoint_id) ?? asString(e.thread_id) ?? sessionId;
    const type = asString(e.type);
    if ((type === "message" || type === "assistant") && asString(e.role) !== "user") {
      const direct = asString(e.content) ?? asString(e.text);
      if (direct) {
        messages.push(direct);
      } else if (Array.isArray(e.content)) {
        for (const part of e.content) {
          const p = part as Record<string, unknown>;
          const t = asString(p.text) ?? asString(p.content);
          if (t) messages.push(t);
        }
      }
    }
  }
  return { text: messages.join("").trim(), sessionId };
}

// ── the registry ─────────────────────────────────────────────────────────────

export const HARNESS_REGISTRY: Record<string, HarnessSpec> = {
  hermes_local: {
    bin: () => binFor("HERMES_BIN", path.join(os.homedir(), ".local", "bin", "hermes")),
    resolveHome: (cfg, companyId) =>
      envHome(cfg, "HOME", "HERMES_HOME") ?? managedCompanyHome(companyId, "hermes-home"),
    homeEnv: (home) => ({ HOME: home, HERMES_HOME: home }),
    buildArgs: ({ prompt, model, provider, resumeSessionId }) => {
      const args = ["chat", "-q", prompt, "-Q", "--source", "tool", "--yolo"];
      if (model) args.push("-m", model);
      if (provider && provider !== "auto") args.push("--provider", provider);
      if (resumeSessionId) args.push("--resume", resumeSessionId);
      return { args };
    },
    parseOutput: parseHermes,
    // hermes' `chat` has no structured event stream; its ACP mode (JSON-RPC)
    // does. Prefer ACP for rich reasoning/tool cards; fall back to chat -Q.
    runner: runHermes,
  },

  claude_local: {
    bin: () => binFor("CLAUDE_BIN", "claude"),
    resolveHome: (cfg) => envHome(cfg, "CLAUDE_CONFIG_DIR") ?? path.resolve(os.homedir(), ".claude"),
    homeEnv: (home) => ({ CLAUDE_CONFIG_DIR: home }),
    buildArgs: ({ prompt, model, resumeSessionId, mcpConfigPath }) => {
      // Prompt via stdin (the `-` after --print); NDJSON event stream out.
      // --include-partial-messages adds token-level stream_event lines so the
      // card stream can render reasoning/tool/answer incrementally (typewriter).
      const args = ["--print", "-", "--output-format", "stream-json", "--verbose",
        "--include-partial-messages", "--dangerously-skip-permissions"];
      // Honcho memory MCP (scoped per turn); strict = ignore the user's global MCPs.
      if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath, "--strict-mcp-config");
      if (model) args.push("--model", model);
      if (resumeSessionId) args.push("--resume", resumeSessionId);
      return { args, stdin: prompt };
    },
    parseOutput: parseClaude,
    makeStreamParser: makeClaudeStreamParser,
    mcp: true,
    systemArgs: (system) => ["--append-system-prompt", system],
  },

  codex_local: {
    bin: () => binFor("CODEX_BIN", "codex"),
    resolveHome: (cfg) => envHome(cfg, "CODEX_HOME") ?? path.resolve(os.homedir(), ".codex"),
    homeEnv: (home) => ({ CODEX_HOME: home }),
    buildArgs: ({ prompt, model }) => {
      // Prompt via stdin; JSONL events out. Bypass approvals for headless run.
      const args = ["exec", "--json", "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox"];
      if (model) args.push("--model", model);
      return { args, stdin: prompt };
    },
    parseOutput: parseCodex,
    makeStreamParser: makeCodexStreamParser,
  },

  gemini_local: {
    bin: () => binFor("GEMINI_BIN", "gemini"),
    // gemini-cli finds its config via HOME (no dedicated home var).
    resolveHome: (cfg) => envHome(cfg, "GEMINI_CLI_HOME", "HOME") ?? os.homedir(),
    homeEnv: (home) => ({ HOME: home }),
    buildArgs: ({ prompt, model, resumeSessionId }) => {
      const args = ["--output-format", "stream-json"];
      if (resumeSessionId) args.push("--resume", resumeSessionId);
      if (model) args.push("--model", model);
      args.push("--approval-mode", "yolo", "--sandbox=none", "--prompt", prompt);
      return { args };
    },
    parseOutput: parseGemini,
    makeStreamParser: makeGeminiStreamParser,
  },
};

// ── hermes ACP runner ─────────────────────────────────────────────────────────

/** Extract text from an ACP content block (string, {type:text,text}, or array). */
function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(textOfContent).join("");
  if (content && typeof content === "object") return rawStr((content as Record<string, unknown>).text);
  return "";
}

/**
 * Pick the model id to set on an ACP session. Unlike `chat`, an ACP session
 * does NOT apply hermes' built-in default — with no config.yaml in the managed
 * home the session model is empty, which 404s the provider. So we set one
 * explicitly: the agent's configured model, else an env override, else the best
 * model the agent advertised (prefer a non-"lite" tier), else its current/first.
 */
function pickAcpModel(sessionResult: Record<string, unknown> | undefined, cfgModel?: string): string | undefined {
  if (cfgModel) return cfgModel;
  const envModel = asString(process.env.HERMES_ACP_MODEL);
  if (envModel) return envModel;
  const models = sessionResult?.models as Record<string, unknown> | undefined;
  const avail = (models?.availableModels as Array<Record<string, unknown>> | undefined) ?? [];
  const ids = avail.map((m) => asString(m.modelId)).filter((x): x is string => !!x);
  return ids.find((id) => !/lite/i.test(id)) ?? asString(models?.currentModelId) ?? ids[0];
}

/**
 * Text out of an ACP tool_call `content[]` block. hermes 0.15+ shapes these as
 * `{type:"content", content:{type:"text", text:"$ date"}}` (a command preview),
 * so unwrap the inner `content` before falling back to plain text extraction.
 */
function acpToolContentText(content: unknown): string {
  if (!Array.isArray(content)) return textOfContent(content);
  return content
    .map((b) => {
      if (b && typeof b === "object" && "content" in (b as Record<string, unknown>)) {
        return textOfContent((b as Record<string, unknown>).content);
      }
      return textOfContent(b);
    })
    .join("");
}

/** Build a tool-card description from an ACP tool_call update. */
function summarizeAcpTool(u: Record<string, unknown>): string | undefined {
  // Older/MCP tools still send a structured rawInput.
  const raw = u.rawInput;
  if (raw && typeof raw === "object") {
    const name = asString(u.kind) ?? asString(u.title) ?? "tool";
    return summarizeToolInput(name, raw as Record<string, unknown>);
  }
  // hermes 0.15+ drops rawInput; the command/preview lives in content[]
  // (e.g. "$ date"). Use its first line as the card description.
  const preview = acpToolContentText(u.content).split(/\r?\n/)[0]?.trim();
  if (preview) return preview.replace(/^\$\s+/, "").slice(0, 160);
  return undefined;
}

/**
 * Run a hermes turn over ACP (Agent Client Protocol) — newline-delimited
 * JSON-RPC 2.0 on stdio. Sequence: initialize → session/new (or session/load
 * to resume) → session/prompt, while mapping session/update notifications to
 * HarnessEvents (agent_thought_chunk → thinking, tool_call → tool_use,
 * agent_message_chunk → text_delta) and auto-granting permission requests.
 */
function runHermesAcp(cfg: AgentInvokeConfig, opts: RunChatOptions): Promise<RunChatResult> {
  const home = envHome(cfg.adapterConfig, "HOME", "HERMES_HOME")
    ?? managedCompanyHome(cfg.companyId, "hermes-home");
  // Inject persona only on a fresh turn; a resumed ACP session already has it.
  // hermes has no per-turn system flag, so memory recall folds into the prompt.
  const persona = opts.resumeSessionId ? "" : readPersona(cfg.adapterConfig);
  const promptText = composePrompt(persona, opts.prompt, opts.memoryContext);
  const bin = binFor("HERMES_BIN", path.join(os.homedir(), ".local", "bin", "hermes"));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home,
    HERMES_HOME: home,
    ...((cfg.adapterConfig.env as Record<string, string> | undefined) ?? {}),
  };
  // adapterConfig.env may override HOME; re-pin the hermes home afterward.
  env.HOME = home;
  env.HERMES_HOME = home;
  const cwd = asString(cfg.adapterConfig.cwd) || home;

  return new Promise<RunChatResult>((resolve) => {
    const child = spawn(bin, ["acp", "--accept-hooks"], { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    let settled = false;
    let answer = "";
    let thinking = "";
    // session/load replays prior turns as session/update BEFORE responding, so
    // ignore all updates until we've sent the prompt — otherwise the replayed
    // history contaminates the answer (and flickers the card).
    let live = false;
    let sessionId: string | undefined = opts.resumeSessionId;
    let stderrTail = "";
    let lineBuf = "";
    let nextId = 0;
    const pending = new Map<number, (msg: Record<string, unknown>) => void>();

    const finish = (r: RunChatResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve(r);
    };
    const timer = setTimeout(
      () => finish({ text: answer.trim(), sessionId, error: "timed_out" }),
      opts.timeoutMs ?? 300_000,
    );
    const onAbort = () => finish({ text: answer.trim(), sessionId, error: "aborted" });
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const send = (obj: unknown) => { try { child.stdin?.write(JSON.stringify(obj) + "\n"); } catch { /* ignore */ } };
    const request = (method: string, params: unknown): Promise<Record<string, unknown>> => {
      const id = ++nextId;
      return new Promise((res) => { pending.set(id, res); send({ jsonrpc: "2.0", id, method, params }); });
    };

    const handleUpdate = (u: Record<string, unknown>) => {
      if (!live) return; // suppress session/load replay (history, not this turn)
      switch (asString(u.sessionUpdate)) {
        case "agent_message_chunk": {
          const t = textOfContent(u.content);
          if (t) { answer += t; opts.onText?.(answer); opts.onEvent?.({ type: "text_delta", text: answer }); }
          break;
        }
        case "agent_thought_chunk": {
          const t = textOfContent(u.content);
          if (t) { thinking += t; opts.onEvent?.({ type: "thinking", text: thinking }); }
          break;
        }
        case "tool_call": {
          const name = asString(u.title) ?? asString(u.kind) ?? "tool";
          opts.onEvent?.({ type: "tool_use", toolName: name, description: summarizeAcpTool(u) });
          break;
        }
        // tool_call_update / plan / usage_update / *_commands_update — not cards
      }
    };

    const handleMessage = (msg: Record<string, unknown>) => {
      const id = msg.id;
      const method = asString(msg.method);
      if (method === "session/update") {
        const u = (msg.params as Record<string, unknown> | undefined)?.update as Record<string, unknown> | undefined;
        if (u) handleUpdate(u);
        return;
      }
      if (method && (typeof id === "number")) {
        // Agent → client request needing a response.
        if (method.includes("request_permission")) {
          const params = (msg.params as Record<string, unknown> | undefined) ?? {};
          const options = (params.options as Array<Record<string, unknown>> | undefined) ?? [];
          const pick = options.find((o) => ["allow_once", "allow_always", "allow"].includes(asString(o.kind) ?? ""))
            ?? options[0];
          send({ jsonrpc: "2.0", id, result: { outcome: { outcome: "selected", optionId: pick?.optionId } } });
        } else {
          // Unsupported request (e.g. fs/*): refuse so the agent proceeds.
          send({ jsonrpc: "2.0", id, error: { code: -32601, message: "not supported" } });
        }
        return;
      }
      if (typeof id === "number" && pending.has(id)) {
        const res = pending.get(id)!;
        pending.delete(id);
        res(msg);
      }
    };

    child.stdout?.on("data", (buf: Buffer) => {
      lineBuf += buf.toString();
      const parts = lineBuf.split(/\r?\n/);
      lineBuf = parts.pop() ?? "";
      for (const line of parts) {
        const t = line.trim();
        if (!t) continue;
        try {
          const v = JSON.parse(t);
          if (v && typeof v === "object") handleMessage(v as Record<string, unknown>);
        } catch { /* partial/non-JSON — skip */ }
      }
    });
    child.stderr?.on("data", (buf: Buffer) => { stderrTail = (stderrTail + buf.toString()).slice(-400); });
    child.on("error", (err) => finish({ text: "", error: `spawn failed: ${String(err)}` }));
    child.on("close", (code) => {
      finish({
        text: answer.trim(),
        sessionId,
        error: answer.trim() ? undefined : `exit ${code}${stderrTail ? `: ${stderrTail}` : ""}`,
      });
    });

    // Drive the protocol.
    void (async () => {
      try {
        await request("initialize", {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        });
        if (sessionId) {
          const loaded = await request("session/load", { sessionId, cwd, mcpServers: [] });
          if (loaded.error) sessionId = undefined; // stale id — start fresh
        }
        let sessionResult: Record<string, unknown> | undefined;
        if (!sessionId) {
          const created = await request("session/new", { cwd, mcpServers: [] });
          sessionResult = created.result as Record<string, unknown> | undefined;
          sessionId = asString(sessionResult?.sessionId);
        }
        if (!sessionId) { finish({ text: "", error: "acp: no session" }); return; }
        // ACP sessions start with no model when the managed home has no config;
        // set one explicitly or the provider 404s on an empty-model URL.
        const modelId = pickAcpModel(sessionResult, asString(cfg.adapterConfig.model));
        if (modelId) await request("session/set_model", { sessionId, modelId });
        live = true; // replay (if any) is done; updates from here are this turn
        const pr = await request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: promptText }],
        });
        const stop = asString((pr.result as Record<string, unknown> | undefined)?.stopReason);
        finish({
          text: answer.trim(),
          sessionId,
          error: answer.trim() ? undefined : `no_output${stop ? ` (${stop})` : ""}`,
        });
      } catch (e) {
        finish({ text: answer.trim(), sessionId, error: `acp: ${String(e)}` });
      }
    })();
  });
}

/**
 * hermes runner: prefer ACP (rich cards), fall back to the reliable one-shot
 * `chat -Q` path when ACP yields nothing (protects the live agent from any ACP
 * instability — no rich cards on the fallback, but the answer still lands).
 */
async function runHermes(cfg: AgentInvokeConfig, opts: RunChatOptions): Promise<RunChatResult> {
  const r = await runHermesAcp(cfg, opts);
  if (r.text) return r;
  return runHarness(HARNESS_REGISTRY.hermes_local, cfg, opts);
}

// ── generic runner ───────────────────────────────────────────────────────────

function runHarness(
  spec: HarnessSpec,
  cfg: AgentInvokeConfig,
  opts: RunChatOptions,
): Promise<RunChatResult> {
  const home = spec.resolveHome(cfg.adapterConfig, cfg.companyId);
  // Inject persona only on a fresh turn; a resumed session already has it.
  const persona = opts.resumeSessionId ? "" : readPersona(cfg.adapterConfig);
  // Honcho agent-MCP TOOLS path: only for MCP-capable harnesses, with a scope,
  // and explicitly enabled (default off — plugin-write handles memory).
  const useHoncho = !!(opts.honcho && spec.mcp && honchoMcpToolsEnabled());
  const mcpConfigPath = useHoncho ? writeHonchoMcpConfig(opts.honcho!) : undefined;
  const extra = useHoncho ? honchoInstructions(opts.honcho!) : undefined;

  // System content (persona + memory instructions) goes to the harness's system
  // channel when it has one (claude --append-system-prompt), keeping the user
  // message clean; otherwise it's folded into the prompt.
  const systemText = [persona, opts.memoryContext, extra].filter((s) => s && s.trim()).join("\n\n");
  const useSystemArgs = !!(systemText && spec.systemArgs);
  const { args, stdin } = spec.buildArgs({
    prompt: useSystemArgs ? opts.prompt : composePrompt(systemText, opts.prompt),
    model: asString(cfg.adapterConfig.model),
    provider: asString(cfg.adapterConfig.provider),
    resumeSessionId: opts.resumeSessionId,
    mcpConfigPath,
  });
  if (useSystemArgs) args.push(...spec.systemArgs!(systemText));

  // The sandboxed worker is forked without HOME, but CLI launchers resolve
  // their versioned binary under $HOME (e.g. ~/.local/share/claude/versions).
  // Establish a baseline HOME, then let per-harness homeEnv override it
  // (hermes/gemini point HOME at the agent home; claude/codex keep the real one
  // and scope via CLAUDE_CONFIG_DIR / CODEX_HOME instead).
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: asString(process.env.HOME) ?? os.homedir(),
    ...((cfg.adapterConfig.env as Record<string, string> | undefined) ?? {}),
    ...spec.homeEnv(home),
  };
  const cwd = asString(cfg.adapterConfig.cwd) || home;

  return new Promise<RunChatResult>((resolve) => {
    let raw = "";
    let stderr = "";
    let settled = false;
    // Per-line event mapper for harnesses that support rich streaming (Claude).
    const streamParser =
      spec.makeStreamParser && opts.onEvent ? spec.makeStreamParser() : null;
    let lineBuf = "";
    const child = spawn(spec.bin(), args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });

    const finish = (r: RunChatResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(r);
    };

    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      finish({ ...spec.parseOutput(raw), error: "timed_out" });
    }, opts.timeoutMs ?? 300_000);

    const onAbort = () => { try { child.kill("SIGKILL"); } catch { /* ignore */ } };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    // Always close stdin. Harnesses that take the prompt via argv (hermes,
    // gemini) will otherwise block reading an open stdin pipe that never EOFs
    // (it works manually only because a terminal stdin is interactive).
    if (stdin !== undefined) child.stdin?.write(stdin);
    child.stdin?.end();

    child.stdout?.on("data", (buf: Buffer) => {
      const s = buf.toString();
      raw += s;
      if (streamParser && opts.onEvent) {
        // Feed complete lines to the mapper; keep the partial trailing line.
        lineBuf += s;
        const parts = lineBuf.split(/\r?\n/);
        lineBuf = parts.pop() ?? "";
        for (const line of parts) {
          const t = line.trim();
          if (!t) continue;
          let parsed: Record<string, unknown> | null = null;
          try {
            const v = JSON.parse(t);
            if (v && typeof v === "object") parsed = v as Record<string, unknown>;
          } catch { /* partial/non-JSON line — skip */ }
          if (parsed) streamParser(parsed, opts.onEvent);
        }
      } else if (opts.onText || opts.onEvent) {
        // Text-mode fallback: re-derive the full answer and emit it as a snapshot.
        const { text } = spec.parseOutput(raw);
        if (text) {
          opts.onText?.(text);
          opts.onEvent?.({ type: "text_delta", text });
        }
      }
    });
    child.stderr?.on("data", (buf: Buffer) => { stderr += buf.toString(); });

    child.on("error", (err) => finish({ text: "", error: `spawn failed: ${String(err)}` }));
    child.on("close", (code) => {
      const parsed = spec.parseOutput(raw);
      finish({
        ...parsed,
        error: code === 0 ? undefined : `exit ${code}${stderr ? `: ${stderr.slice(-300)}` : ""}`,
      });
    });
  });
}

/**
 * Read an agent's harness config from Paperclip and run a conversational turn
 * against it directly. Dispatches via HARNESS_REGISTRY on adapterType.
 */
export async function runAgentChat(
  ctx: PluginContext,
  params: { agentId: string; companyId: string },
  opts: RunChatOptions,
): Promise<RunChatResult> {
  const agent = await ctx.agents.get(params.agentId, params.companyId);
  if (!agent) return { text: "", error: `agent not found: ${params.agentId}` };

  const adapterType = (agent as { adapterType?: string }).adapterType ?? "hermes_local";
  const adapterConfig =
    ((agent as { adapterConfig?: Record<string, unknown> }).adapterConfig) ?? {};

  const spec = HARNESS_REGISTRY[adapterType];
  if (!spec) return { text: "", error: `unsupported adapterType: ${adapterType}` };

  const invokeCfg: AgentInvokeConfig = {
    agentId: params.agentId, companyId: params.companyId, adapterType, adapterConfig,
  };

  // Honcho scope (opts.honcho) is resolved by the caller (webhook) and used for
  // plugin-write; the per-turn agent-MCP TOOLS path below is opt-in + separate.
  if (spec.runner) return spec.runner(invokeCfg, opts);
  return runHarness(spec, invokeCfg, opts);
}
