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
 */

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { PluginContext } from "@paperclipai/plugin-sdk";

export type HarnessKind = "hermes_local" | "claude_local";

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

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Resolve the Hermes home for an agent, mirroring the hermes-local adapter's
 * `resolveHermesHome`: explicit adapterConfig.env override first, else the
 * Paperclip-managed per-company home. (Per-agent homes, when the provisioner
 * writes them, arrive here as the adapterConfig.env.HERMES_HOME override.)
 */
export function resolveHermesHome(
  adapterConfig: Record<string, unknown>,
  companyId: string,
): string {
  const env = (adapterConfig.env as Record<string, unknown> | undefined) ?? {};
  const configured = asString(env.HOME) || asString(env.HERMES_HOME);
  if (configured) return path.resolve(configured);

  const paperclipHome =
    asString(process.env.PAPERCLIP_HOME) ?? path.resolve(os.homedir(), ".paperclip");
  const instanceId = asString(process.env.PAPERCLIP_INSTANCE_ID) ?? "default";
  return path.resolve(
    paperclipHome,
    "instances",
    instanceId,
    "companies",
    companyId,
    "hermes-home",
  );
}

/**
 * Strip Hermes/Paperclip process noise from `-Q` output, leaving only the
 * agent's conversational response. Quiet mode emits a trailing
 * `session_id: <id>` line plus occasional `[hermes]`/`[paperclip]` status
 * lines; everything else is the real answer.
 */
export function cleanHermesOutput(raw: string): { text: string; sessionId?: string } {
  let sessionId: string | undefined;
  const kept: string[] = [];
  for (const line of raw.split("\n")) {
    const sid = line.match(/^\s*session_id:\s*(\S+)\s*$/i);
    if (sid) {
      sessionId = sid[1];
      continue;
    }
    if (/^\s*\[(hermes|paperclip)\]/i.test(line)) continue;
    kept.push(line);
  }
  return { text: kept.join("\n").trim(), sessionId };
}

const HERMES_BIN =
  asString(process.env.HERMES_BIN) ??
  path.join(os.homedir(), ".local", "bin", "hermes");

/**
 * Invoke Hermes directly: `hermes chat -q <prompt> -Q --source tool --yolo`,
 * with HOME + HERMES_HOME pointed at the agent's home. Streams cleaned text
 * via onText and returns the final answer + session id.
 */
async function runHermesChat(
  cfg: AgentInvokeConfig,
  opts: RunChatOptions,
): Promise<RunChatResult> {
  const home = resolveHermesHome(cfg.adapterConfig, cfg.companyId);
  const model = asString(cfg.adapterConfig.model);
  const provider = asString(cfg.adapterConfig.provider);

  const args = ["chat", "-q", opts.prompt, "-Q", "--source", "tool", "--yolo"];
  if (model) args.push("-m", model);
  if (provider && provider !== "auto") args.push("--provider", provider);
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...((cfg.adapterConfig.env as Record<string, string> | undefined) ?? {}),
    HOME: home,
    HERMES_HOME: home,
  };
  const cwd = asString(cfg.adapterConfig.cwd) || home;

  return await new Promise<RunChatResult>((resolve) => {
    let raw = "";
    let settled = false;
    const child = spawn(HERMES_BIN, args, { env, cwd });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
        const { text, sessionId } = cleanHermesOutput(raw);
        resolve({ text, sessionId, error: "timed_out" });
      }
    }, opts.timeoutMs ?? 300_000);

    const onAbort = () => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (buf: Buffer) => {
      raw += buf.toString();
      if (opts.onText) {
        const { text } = cleanHermesOutput(raw);
        if (text) opts.onText(text);
      }
    });
    // Hermes writes status noise to stderr; keep it out of the answer but
    // retain it for error diagnosis.
    let stderr = "";
    child.stderr?.on("data", (buf: Buffer) => { stderr += buf.toString(); });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ text: "", error: `spawn failed: ${String(err)}` });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      const { text, sessionId } = cleanHermesOutput(raw);
      resolve({
        text,
        sessionId,
        error: code === 0 ? undefined : `exit ${code}${stderr ? `: ${stderr.slice(-300)}` : ""}`,
      });
    });
  });
}

/**
 * Read an agent's harness config from Paperclip and run a conversational turn
 * against it directly. Branches on adapterType.
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
    ((agent as { adapterConfig?: Record<string, unknown> }).adapterConfig as
      | Record<string, unknown>
      | undefined) ?? {};

  const cfg: AgentInvokeConfig = {
    agentId: params.agentId,
    companyId: params.companyId,
    adapterType,
    adapterConfig,
  };

  switch (adapterType) {
    case "hermes_local":
      return await runHermesChat(cfg, opts);
    case "claude_local":
      // Claude Code direct invoke is a separate CLI shape; wired next increment.
      return {
        text: "",
        error: "claude_local direct invoke not yet wired (next increment)",
      };
    default:
      return { text: "", error: `unsupported adapterType: ${adapterType}` };
  }
}
