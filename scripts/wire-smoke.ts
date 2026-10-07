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
 *      and whose body is exactly the real request's cut to its head; the real request follows with the header;
 *   3. every request carries the header, pi's own compaction (summarizer) request included.
 * Exits 1 naming the first check that failed. `--keep` leaves the temporary directory for inspection; `--verbose`
 * prints one line per request (header present or not, message roles, output cap; no content).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startFakeModel } from "./fake-model.ts";
import { FAKE_MODEL, FAKE_PROVIDER, driveSession, writeAgentDir } from "./pi-rpc.ts";
import { checkWire, type WireRequest } from "./wire-checks.ts";

const HEADER = "x-session-id";
const CONFIG = { headers: { [FAKE_PROVIDER]: { [HEADER]: "{sessionId}" } }, boundary: [FAKE_PROVIDER] };

/** One line per request for `--verbose`: the header's presence, the message roles and the output cap, never content. */
function describeRequest(index: number, request: WireRequest): string {
  const body = (request.body ?? {}) as { messages?: Array<{ role?: string }>; max_tokens?: number; max_completion_tokens?: number };
  const roles = (body.messages ?? []).map((message) => message.role ?? "?").join(",");
  return `  #${index + 1} ${HEADER}=${request.headers[HEADER] === undefined ? "absent" : "present"} messages=[${roles}] cap=${body.max_tokens ?? body.max_completion_tokens ?? "none"}`;
}

async function main(): Promise<number> {
  const keep = process.argv.includes("--keep");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-affinity-smoke-"));
  const fake = await startFakeModel(FAKE_MODEL);
  try {
    const sessionId = await driveSession({ root, agentDir: writeAgentDir(root, fake.port, CONFIG), model: `${FAKE_PROVIDER}/${FAKE_MODEL}` });
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
