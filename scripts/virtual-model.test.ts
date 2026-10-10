/**
 * A session on a virtual (routing) model, on the real vendored pi: the virtual model's provider is configured for
 * headers and the boundary request, the router sends every request to another provider's model, and nothing the
 * extension adds may reach that provider. pi's header event names no model, and ctx.model stays the virtual one, so
 * headers chosen by its provider name would ride on whatever the router picked.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { startFakeModel } from "./fake-model.ts";
import { FAKE_MODEL, driveSession, writeAgentDir, type RpcRecord } from "./pi-rpc.ts";

const CONFIG = { headers: { "example-router": { "x-session-id": "{sessionId}", "x-route-tag": "configured" } }, boundary: ["example-router"] };

test("a virtual model routed to another provider receives no configured header and no boundary request", { timeout: 180_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-affinity-virtual-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fake = await startFakeModel(FAKE_MODEL);
  t.after(() => fake.server.close());
  const notices: RpcRecord[] = [];
  await driveSession({
    root,
    agentDir: writeAgentDir(root, fake.port, CONFIG),
    model: "example-router/auto",
    extraExtensions: [path.join(import.meta.dirname, "fixtures", "example-router.ts")],
    onRecord: (record) => { if (record.type === "extension_ui_request" && record.method === "notify") notices.push(record); },
  });
  const requests = fake.requests();
  assert.ok(requests.length >= 4, `the session made only ${requests.length} request(s)`);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.headers["x-session-id"], undefined, `request #${index + 1} carried x-session-id`);
    assert.equal(request.headers["x-route-tag"], undefined, `request #${index + 1} carried x-route-tag`);
    const body = request.body as { max_tokens?: number; max_completion_tokens?: number };
    assert.notEqual(body.max_tokens ?? body.max_completion_tokens, 1, `request #${index + 1} is a boundary request`);
  }
  // pi's model registry lists the virtual model, so the session-start check can say why nothing is sent.
  const warning = notices.find((notice) => /"example-router", which lists virtual \(routing\) models/.test(notice.message ?? ""));
  assert.ok(warning, `no virtual-model warning; notices: ${JSON.stringify(notices.map((notice) => notice.message))}`);
  assert.equal(warning.notifyType, "warning");
});
