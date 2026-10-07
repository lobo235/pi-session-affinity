/**
 * Runs the pi this repository vendors in RPC mode, in a fresh agent dir and HOME, against the fake model on
 * loopback (fake-model.ts): the shared driver of the wire smoke and the real-pi tests. No network, no key, no state
 * of the person running it is read or written.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Readable, Writable } from "node:stream";

const repo = path.join(import.meta.dirname, "..");
const STEP_TIMEOUT_MS = 60_000;

export const FAKE_PROVIDER = "example-gateway";
export const FAKE_MODEL = "example-model";

/**
 * A fresh agent dir: models.json with one provider on the fake model's port (pi's own affinity headers on), the
 * extension's config, and a compaction that keeps almost nothing, so a two-turn session has something to compact.
 */
export function writeAgentDir(root: string, port: number, config: unknown): string {
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(agentDir, { mode: 0o700 });
  const model = { id: FAKE_MODEL, name: FAKE_MODEL, contextWindow: 131072, maxTokens: 4096, input: ["text"], reasoning: false, compat: { sendSessionAffinityHeaders: true } };
  const models = { providers: { [FAKE_PROVIDER]: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "unused", models: [model] } } };
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify(models, null, 2));
  fs.writeFileSync(path.join(agentDir, "session-affinity.json"), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 1 } }, null, 2));
  return agentDir;
}

export type RpcRecord = { type?: string; id?: string; success?: boolean; error?: string; data?: { sessionId?: string }; method?: string; message?: string; notifyType?: string };

/** A minimal RPC client: sends commands and waits for records, splitting stdout on LF only (pi's docs/rpc.md, Framing). */
function rpcClient(child: ChildProcessByStdio<Writable, Readable, null>, onRecord: (record: RpcRecord) => void) {
  const waiters: Array<{ match: (record: RpcRecord) => boolean; resolve: (record: RpcRecord) => void }> = [];
  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    for (let newline = buffered.indexOf("\n"); newline >= 0; newline = buffered.indexOf("\n")) {
      const line = buffered.slice(0, newline).replace(/\r$/, "");
      buffered = buffered.slice(newline + 1);
      let record: RpcRecord;
      try { record = JSON.parse(line) as RpcRecord; } catch { continue; }
      onRecord(record);
      const index = waiters.findIndex((waiter) => waiter.match(record));
      if (index >= 0) waiters.splice(index, 1)[0].resolve(record);
    }
  });
  const waitFor = (what: string, match: (record: RpcRecord) => boolean) => new Promise<RpcRecord>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${what} within ${STEP_TIMEOUT_MS / 1000} s`)), STEP_TIMEOUT_MS);
    waiters.push({ match, resolve: (record) => { clearTimeout(timer); resolve(record); } });
  });
  const send = (command: object) => child.stdin.write(JSON.stringify(command) + "\n");
  return { send, waitFor };
}

type RpcClient = ReturnType<typeof rpcClient>;

async function command(rpc: RpcClient, id: string, body: object): Promise<RpcRecord> {
  rpc.send({ id, ...body });
  const answer = await rpc.waitFor(`response to ${id}`, (record) => record.type === "response" && record.id === id);
  if (answer.success !== true) throw new Error(`pi refused ${id}: ${answer.error ?? "no error given"}`);
  return answer;
}

async function promptAndSettle(rpc: RpcClient, id: string, message: string): Promise<void> {
  const settled = rpc.waitFor(`agent_settled after ${id}`, (record) => record.type === "agent_settled");
  await command(rpc, id, { type: "prompt", message });
  await settled;
}

/**
 * Drives one session through prompt, prompt, compact, prompt, with this extension plus `extraExtensions` loaded
 * and `model` selected; returns the session id pi reported. `onRecord` sees every RPC record pi writes.
 */
export async function driveSession(options: {
  root: string; agentDir: string; model: string; extraExtensions?: string[]; onRecord?: (record: RpcRecord) => void;
}): Promise<string> {
  const cwd = path.join(options.root, "project");
  fs.mkdirSync(cwd);
  const pi = path.join(repo, "node_modules", ".bin", "pi");
  const extensions = [path.join(repo, "src", "index.ts"), ...(options.extraExtensions ?? [])].flatMap((file) => ["-e", file]);
  const args = ["--mode", "rpc", "--no-extensions", ...extensions, "--model", options.model, "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-session"];
  const env = { ...process.env, HOME: options.root, PI_CODING_AGENT_DIR: options.agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" };
  const child = spawn(pi, args, { cwd, env, stdio: ["pipe", "pipe", "inherit"] });
  const exited = new Promise<never>((_resolve, reject) => child.on("exit", (code) => reject(new Error(`pi exited (${code}) before the session finished`))));
  const rpc = rpcClient(child, options.onRecord ?? (() => {}));
  const steps = (async () => {
    await promptAndSettle(rpc, "first", "Read the README and summarize it.");
    await promptAndSettle(rpc, "follow-up", "And the tests?");
    const state = await command(rpc, "state", { type: "get_state" });
    await command(rpc, "compact", { type: "compact" });
    await promptAndSettle(rpc, "second", "Now list the next step.");
    return state.data?.sessionId ?? "";
  })();
  try {
    return await Promise.race([steps, exited]);
  } finally {
    child.removeAllListeners("exit");
    child.stdin.end();
    child.kill();
  }
}
