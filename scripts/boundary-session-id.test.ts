/**
 * The boundary request passes pi's `sessionId` option so that pi's own session-affinity headers
 * (`compat.sendSessionAffinityHeaders`) ride on it as they do on the real request. That option must only ever add
 * headers: this test takes the options the extension really builds, sends them through pi's openai-completions
 * implementation to a fake server on loopback, once as built and once without `sessionId`, and pins the bodies as
 * byte-identical.
 *
 * `@earendil-works/pi-ai` is imported here on purpose without its own devDependency pin: it resolves to the copy
 * the vendored pi itself uses, so the nightly run against the newest pi tests that pi's implementation.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { complete } from "@earendil-works/pi-ai/compat";

import sessionAffinity from "../src/index.ts";
import { SESSION_ID, fakeCtx, fakePi, fakeRegistry, tempDir, writeConfig } from "../src/test-support.ts";
import { startFakeModel } from "./fake-model.ts";

const PROVIDER = "self-hosted";
const MODEL_ID = "example-hybrid-27b";

/** The options the extension passes to the model registry for one boundary request. */
async function boundaryOptions(t: { after: (fn: () => void) => void }): Promise<Record<string, unknown>> {
  const { pi, emit } = fakePi();
  const configFile = writeConfig(tempDir(t), { boundary: [PROVIDER] });
  sessionAffinity(pi as any, { configPath: () => configFile, writeStderr: () => {} });
  const registry = fakeRegistry();
  const { ctx } = fakeCtx({ provider: PROVIDER, modelId: MODEL_ID, registry });
  await emit("session_compact", { compactionEntry: {}, fromExtension: false, reason: "manual", willRetry: false }, ctx);
  const payload = {
    model: MODEL_ID,
    messages: [{ role: "system", content: "You are a coding agent." }, { role: "user", content: "summary" }, { role: "user", content: "next" }],
    max_tokens: 4096,
    stream: true,
    stream_options: { include_usage: true },
  };
  await emit("before_provider_request", { payload }, ctx);
  assert.equal(registry.sent.length, 1, "the extension sent no boundary request");
  return registry.sent[0].options;
}

test("the boundary request's sessionId option adds pi's affinity headers and leaves the body byte-identical", async (t) => {
  const options = await boundaryOptions(t);
  assert.equal(options.sessionId, SESSION_ID);
  const fake = await startFakeModel(MODEL_ID);
  t.after(() => fake.server.close());
  const model = {
    id: MODEL_ID, name: MODEL_ID, api: "openai-completions" as const, provider: PROVIDER, baseUrl: `http://127.0.0.1:${fake.port}/v1`,
    reasoning: false, input: ["text" as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 4096,
    compat: { sendSessionAffinityHeaders: true },
  };
  const { sessionId: _withheld, ...withoutSessionId } = options;
  for (const callOptions of [options, withoutSessionId]) {
    await complete(model, { systemPrompt: "", messages: [] }, { ...callOptions, apiKey: "unused" });
  }
  const [withId, withoutId] = fake.requests();
  assert.equal(JSON.stringify(withId.body), JSON.stringify(withoutId.body), "the sessionId option changed the request body");
  assert.equal(withId.headers["x-session-affinity"], SESSION_ID, "pi's own affinity header is not on the boundary request");
  assert.equal(withoutId.headers["x-session-affinity"], undefined);
});
