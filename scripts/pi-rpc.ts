/**
 * Runs the pi this repository vendors in RPC mode, in a fresh agent dir and HOME, against the fake model on
 * loopback (fake-model.ts): the shared driver of the wire smoke and the real-pi tests. No network, no key, no state
 * of the person running it is read or written.
 */
import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Readable, Writable } from "node:stream";

import { CONFIG_FILE_NAME } from "../src/config.ts";

export const REPO = path.join(import.meta.dirname, "..");
const PI_PACKAGE = path.join(REPO, "node_modules", "@earendil-works", "pi-coding-agent");
/**
 * The vendored pi's entry script, from its package.json `bin`. pi is started as `node <entry>` rather than through
 * `node_modules/.bin/pi`: on Windows npm installs that bin as a .cmd shim, which spawn() cannot start without a shell.
 */
const PI_CLI = path.join(PI_PACKAGE, (JSON.parse(fs.readFileSync(path.join(PI_PACKAGE, "package.json"), "utf8")) as { bin: { pi: string } }).bin.pi);
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
  fs.writeFileSync(path.join(agentDir, CONFIG_FILE_NAME), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 1 } }, null, 2));
  return agentDir;
}

/**
 * What pi may inherit from the parent: enough to find node and a temp dir and to pick a locale, plus what Windows
 * needs to start a process at all. HOME and USERPROFILE (Windows' home) are always the temporary root. Nothing else, so a key in the environment of whoever runs the tests never
 * reaches the pi they start.
 */
const INHERITED_ENV = ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SystemRoot", "ComSpec", "PATHEXT"];

/** The environment every pi this harness starts gets: the temporary HOME and agent dir, offline, no telemetry. */
export function piEnv(root: string, agentDir: string, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(INHERITED_ENV.flatMap((name) => (parent[name] === undefined ? [] : [[name, parent[name]]])));
  return { ...inherited, HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" };
}

/** Starts the vendored pi with `args` under the node running this script, in `cwd`, with piEnv's environment. */
export function spawnPi(args: string[], cwd: string, root: string, agentDir: string): ChildProcessByStdio<Writable, Readable, null> {
  return spawn(process.execPath, [PI_CLI, ...args], { cwd, env: piEnv(root, agentDir), stdio: ["pipe", "pipe", "inherit"] });
}

/** Runs the vendored pi with `args` to completion; throws, with its stderr, when it exits non-zero. */
export function runPi(args: string[], cwd: string, root: string, agentDir: string): void {
  execFileSync(process.execPath, [PI_CLI, ...args], { cwd, env: piEnv(root, agentDir), stdio: ["ignore", "pipe", "pipe"] });
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
 * and `model` selected; returns the session id pi reported. `onRecord` sees every RPC record pi writes. The
 * extension is loaded from `src/index.ts` with `-e`, or, with `installed`, from the package `pi install` put in the
 * agent dir (pack-install.ts), with nothing passed on the command line.
 */
export async function driveSession(options: {
  root: string; agentDir: string; model: string; installed?: boolean; extraExtensions?: string[]; onRecord?: (record: RpcRecord) => void;
}): Promise<string> {
  const cwd = path.join(options.root, "project");
  fs.mkdirSync(cwd);
  const source = options.installed ? [] : ["--no-extensions", "-e", path.join(REPO, "src", "index.ts")];
  const extensions = [...source, ...(options.extraExtensions ?? []).flatMap((file) => ["-e", file])];
  const args = ["--mode", "rpc", ...extensions, "--model", options.model, "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-session"];
  const child = spawnPi(args, cwd, options.root, options.agentDir);
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
    // Return only once pi has exited: Windows refuses to delete a directory a running process works in, so a
    // caller's cleanup would fail, and a test's remaining cleanup (the fake model's server) would never run.
    if (child.exitCode === null && child.signalCode === null) {
      const gone = once(child, "exit");
      child.kill();
      await gone;
    }
  }
}
