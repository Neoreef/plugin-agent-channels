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

export interface AgentInvokeConfig {
  agentId: string;
  companyId: string;
  adapterType: string;
  /** Raw adapterConfig from Paperclip (model, provider, env, cwd, …). */
  adapterConfig: Record<string, unknown>;
}

export interface RunChatOptions {
  prompt: string;
  /** Called with each cleaned incremental text snapshot (full text so far). */
  onText?: (textSoFar: string) => void;
  /** Resume a prior harness session for conversational continuity. */
  resumeSessionId?: string;
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
}

// ── helpers ────────────────────────────────────────────────────────────────

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
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

/** Frame persona + the user's message into a single turn for headless CLIs. */
function composePrompt(persona: string, userPrompt: string): string {
  if (!persona) return userPrompt;
  return [
    "You are operating under the following agent instructions. Stay in character and follow them for this conversation.",
    "",
    "<agent_instructions>",
    persona,
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
  },

  claude_local: {
    bin: () => binFor("CLAUDE_BIN", "claude"),
    resolveHome: (cfg) => envHome(cfg, "CLAUDE_CONFIG_DIR") ?? path.resolve(os.homedir(), ".claude"),
    homeEnv: (home) => ({ CLAUDE_CONFIG_DIR: home }),
    buildArgs: ({ prompt, model, resumeSessionId }) => {
      // Prompt via stdin (the `-` after --print); NDJSON event stream out.
      const args = ["--print", "-", "--output-format", "stream-json", "--verbose",
        "--dangerously-skip-permissions"];
      if (model) args.push("--model", model);
      if (resumeSessionId) args.push("--resume", resumeSessionId);
      return { args, stdin: prompt };
    },
    parseOutput: parseClaude,
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
  },
};

// ── generic runner ───────────────────────────────────────────────────────────

function runHarness(
  spec: HarnessSpec,
  cfg: AgentInvokeConfig,
  opts: RunChatOptions,
): Promise<RunChatResult> {
  const home = spec.resolveHome(cfg.adapterConfig, cfg.companyId);
  const persona = readPersona(cfg.adapterConfig);
  const { args, stdin } = spec.buildArgs({
    prompt: composePrompt(persona, opts.prompt),
    model: asString(cfg.adapterConfig.model),
    provider: asString(cfg.adapterConfig.provider),
    resumeSessionId: opts.resumeSessionId,
  });

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
      raw += buf.toString();
      if (opts.onText) {
        const { text } = spec.parseOutput(raw);
        if (text) opts.onText(text);
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

  return runHarness(spec, { agentId: params.agentId, companyId: params.companyId, adapterType, adapterConfig }, opts);
}
