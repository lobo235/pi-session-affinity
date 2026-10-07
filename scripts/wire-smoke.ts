/**
 * Wire smoke: the pi this repository vendors, with only this extension loaded, against a fake OpenAI-compatible
 * model on loopback, checked by what actually reaches the wire. No network, no key, no state of the person running
 * it is read or written: HOME and the agent dir are both a new temporary directory.
 *
 * It runs one prompt, a manual compaction and a second prompt in RPC mode, with a config that sets a session
 * header and opts the provider into the boundary request, and passes when:
 *   1. the first request carries the header with the session's id;
 *   2. the first request after the compaction is a boundary request (system message, ".", one output token) that
 *      carries the header and pi's own `x-session-affinity` (the model enables `compat.sendSessionAffinityHeaders`),
 *      and whose body is exactly the real request's cut to its head; the real request follows with the header.
 * Exits 1 naming the first check that failed. `--keep` leaves the temporary directory for inspection; `--verbose`
 * prints one line per request (header present or not, message roles, output cap; no content).
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkWire, type WireRequest } from "./wire-checks.ts";
import { startFakeModel } from "./fake-model.ts";

const repo = path.join(import.meta.dirname, "..");
const PROVIDER = "example-gateway";
const MODEL = "example-model";
const HEADER = "x-session-id";
const STEP_TIMEOUT_MS = 60_000;

function writeAgentDir(root: string, port: number): string {
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(agentDir, { mode: 0o700 });
  // pi's own affinity headers on too, so the run covers the boundary request's sessionId option on the real path.
  const model = { id: MODEL, name: MODEL, contextWindow: 131072, maxTokens: 4096, input: ["text"], reasoning: false, compat: { sendSessionAffinityHeaders: true } };
  const models = { providers: { [PROVIDER]: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "unused", models: [model] } } };
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify(models, null, 2));
  const config = { headers: { [PROVIDER]: { [HEADER]: "{sessionId}" } }, boundary: [PROVIDER] };
  fs.writeFileSync(path.join(agentDir, "session-affinity.json"), JSON.stringify(config, null, 2));
  // Keep almost nothing at a compaction, so a two-turn session has something to compact.
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 1 } }, null, 2));
  return agentDir;
}

function childEnv(root: string, agentDir: string): NodeJS.ProcessEnv {
  return { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" };
}

type RpcRecord = { type?: string; id?: string; success?: boolean; error?: string; data?: { sessionId?: string } };

/** A minimal RPC client: sends commands and waits for records, splitting stdout on LF only (docs/rpc.md, Framing). */
function rpcClient(child: ChildProcessByStdio<Writable, Readable, null>) {
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

async function promptAndSettle(rpc: ReturnType<typeof rpcClient>, id: string, message: string): Promise<void> {
  const settled = rpc.waitFor(`agent_settled after ${id}`, (record) => record.type === "agent_settled");
  rpc.send({ id, type: "prompt", message });
  const answer = await rpc.waitFor(`response to ${id}`, (record) => record.type === "response" && record.id === id);
  if (answer.success !== true) throw new Error(`pi refused ${id}: ${answer.error ?? "no error given"}`);
  await settled;
}

async function command(rpc: ReturnType<typeof rpcClient>, id: string, body: object): Promise<RpcRecord> {
  rpc.send({ id, ...body });
  const answer = await rpc.waitFor(`response to ${id}`, (record) => record.type === "response" && record.id === id);
  if (answer.success !== true) throw new Error(`pi refused ${id}: ${answer.error ?? "no error given"}`);
  return answer;
}

/** Drives one session through prompt, compact, prompt; returns the session id pi reported. */
async function driveSession(root: string, agentDir: string): Promise<string> {
  const cwd = path.join(root, "project");
  fs.mkdirSync(cwd);
  const pi = path.join(repo, "node_modules", ".bin", "pi");
  const args = ["--mode", "rpc", "--no-extensions", "-e", path.join(repo, "src", "index.ts"), "--model", `${PROVIDER}/${MODEL}`, "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-session"];
  const child = spawn(pi, args, { cwd, env: childEnv(root, agentDir), stdio: ["pipe", "pipe", "inherit"] });
  const exited = new Promise<never>((_resolve, reject) => child.on("exit", (code) => reject(new Error(`pi exited (${code}) before the session finished`))));
  const rpc = rpcClient(child);
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

/** One line per request for `--verbose`: the header's presence, the message roles and the output cap, never content. */
function describeRequest(index: number, request: WireRequest): string {
  const body = (request.body ?? {}) as { messages?: Array<{ role?: string }>; max_tokens?: number; max_completion_tokens?: number };
  const roles = (body.messages ?? []).map((message) => message.role ?? "?").join(",");
  return `  #${index + 1} ${HEADER}=${request.headers[HEADER] === undefined ? "absent" : "present"} messages=[${roles}] cap=${body.max_tokens ?? body.max_completion_tokens ?? "none"}`;
}

async function main(): Promise<number> {
  const keep = process.argv.includes("--keep");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-affinity-smoke-"));
  const fake = await startFakeModel(MODEL);
  try {
    const sessionId = await driveSession(root, writeAgentDir(root, fake.port));
    const requests: WireRequest[] = fake.requests();
    const failure = checkWire(requests, { header: HEADER, sessionId, piHeader: "x-session-affinity" });
    if (process.argv.includes("--verbose")) for (const [index, request] of requests.entries()) console.log(describeRequest(index, request));
    console.log(`wire smoke: ${requests.length} model request(s), session ${sessionId ? "id reported" : "id missing"}: ${failure ?? "ok"}`);
    return failure ? 1 : 0;
  } finally {
    fake.server.close();
    if (keep) console.log(`kept ${root}`);
    else fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then((code) => process.exit(code), (error: unknown) => {
  console.error(`wire smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
