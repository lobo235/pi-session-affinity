/**
 * The boundary request (boundary.ts): what it sends, when, and that nothing about it can hold up or fail the
 * request it precedes.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildBoundaryPayload } from "./boundary.ts";
import sessionAffinity from "./index.ts";
import { SESSION_ID, fakeCtx, fakePi, fakeRegistry, tempDir, writeConfig, type SentRequest } from "./test-support.ts";

const MODEL_ID = "example-hybrid-27b";
const BOUNDARY_CONFIG = { headers: { "self-hosted": { "x-session-id": "{sessionId}" } }, boundary: ["self-hosted"] };

/** A provider payload the way pi's openai-completions API builds it (shape only, invented text). */
function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    model: MODEL_ID,
    messages: [
      { role: "system", content: "You are a coding agent. <skills>...</skills>" },
      { role: "user", content: "summary of the work so far" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "next step" },
    ],
    tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
    reasoning_effort: "medium",
    max_tokens: 32768,
    stream: true,
    stream_options: { include_usage: true },
    prompt_cache_key: SESSION_ID,
    ...overrides,
  };
}

/** Loads the extension with `config` and returns the pieces a boundary test drives. */
function setUp(t: { after: (fn: () => void) => void }, config: unknown, options: { answer?: (call: SentRequest) => unknown; timeoutMs?: number; provider?: string; signal?: AbortSignal } = {}) {
  const { pi, emit } = fakePi();
  const configFile = writeConfig(tempDir(t), config);
  sessionAffinity(pi as any, { configPath: () => configFile, boundaryTimeoutMs: options.timeoutMs ?? 60_000, writeStderr: () => {} });
  const registry = fakeRegistry({ answer: options.answer });
  const { ctx, notices } = fakeCtx({ provider: options.provider ?? "self-hosted", modelId: MODEL_ID, registry, signal: options.signal });
  const compact = () => emit("session_compact", { compactionEntry: {}, fromExtension: false, reason: "threshold", willRetry: false }, ctx);
  const request = (payload: unknown = sessionPayload()) => emit("before_provider_request", { payload }, ctx);
  return { registry, ctx, notices, compact, request };
}

/** What the boundary request puts on the wire: its payload after onPayload, its headers after transformHeaders. */
async function wireOf(sent: SentRequest) {
  return {
    payload: await sent.options.onPayload({ placeholder: true }, sent.model),
    headers: sent.options.transformHeaders ? await sent.options.transformHeaders({}) : {},
  };
}

test("the boundary payload is the request's head: system message, tools and settings, one user character, one output token", () => {
  const payload = sessionPayload();
  assert.deepEqual(buildBoundaryPayload(payload), {
    model: MODEL_ID,
    messages: [{ role: "system", content: "You are a coding agent. <skills>...</skills>" }, { role: "user", content: "." }],
    tools: payload.tools,
    reasoning_effort: "medium",
    max_tokens: 1,
    stream: true,
    stream_options: { include_usage: true },
    prompt_cache_key: SESSION_ID,
  });
});

test("after a compaction, the next request is preceded by one boundary request of its own head", async (t) => {
  const { registry, ctx, compact, request } = setUp(t, BOUNDARY_CONFIG);
  await compact();
  assert.equal(await request(), undefined, "the real request goes out unchanged");
  assert.equal(registry.sent.length, 1);
  const wire = await wireOf(registry.sent[0]);
  assert.deepEqual(wire.payload, buildBoundaryPayload(sessionPayload()));
  assert.deepEqual(wire.headers, { "x-session-id": SESSION_ID });
  assert.equal(registry.sent[0].model, ctx.model);
  assert.equal(registry.sent[0].options.maxTokens, 1);
  assert.equal(registry.sent[0].options.sessionId, SESSION_ID, "pi's own session-affinity headers ride along too");
  await request();
  assert.equal(registry.sent.length, 1, "only the first request after a compaction gets one");
});

// Only a chat-completions request whose first message is the system message has a head to send.
for (const [name, payload] of [
  ["not an object", "a string"],
  ["null", null],
  ["no messages array (another API's shape)", { model: MODEL_ID, input: [] }],
  ["an empty messages array", { model: MODEL_ID, messages: [] }],
  ["a first message that is not the system message", { model: MODEL_ID, messages: [{ role: "user", content: "hi" }] }],
  ["a system message without text", { model: MODEL_ID, messages: [{ role: "system" }] }],
  ["a system message with empty content parts", { model: MODEL_ID, messages: [{ role: "system", content: [] }] }],
] as const) {
  test(`no boundary payload for ${name}`, () => {
    assert.equal(buildBoundaryPayload(payload), undefined);
  });
}

test("a system message given as content parts is a head", () => {
  const parts = [{ type: "text", text: "You are a coding agent." }];
  assert.deepEqual(buildBoundaryPayload({ model: MODEL_ID, messages: [{ role: "system", content: parts }] })?.messages, [{ role: "system", content: parts }, { role: "user", content: "." }]);
});

test("an output cap named max_completion_tokens is the one capped, and no second cap is added", () => {
  const { max_tokens: _dropped, ...rest } = sessionPayload();
  const built = buildBoundaryPayload({ ...rest, max_completion_tokens: 32768 });
  assert.equal(built?.max_completion_tokens, 1);
  assert.equal("max_tokens" in (built ?? {}), false);
});

test("the request pi is about to send is never changed", () => {
  const payload = sessionPayload();
  const before = structuredClone(payload);
  buildBoundaryPayload(payload);
  assert.deepEqual(payload, before);
});

// When no boundary request is sent: each row is one reason the extension stands aside.
for (const [name, config, options] of [
  ["the provider is not in boundary (headers alone do not opt in)", { headers: BOUNDARY_CONFIG.headers }, {}],
  ["the session is on another provider", BOUNDARY_CONFIG, { provider: "example-provider" }],
  ["there is no config file content", {}, {}],
  ["the config file is invalid", { boundary: "self-hosted" }, {}],
] as const) {
  test(`no boundary request when ${name}`, async (t) => {
    const { registry, compact, request } = setUp(t, config, options);
    await compact();
    assert.equal(await request(), undefined);
    assert.equal(registry.sent.length, 0);
  });
}

test("no compaction, no boundary request", async (t) => {
  const { registry, request } = setUp(t, BOUNDARY_CONFIG);
  await request();
  assert.equal(registry.sent.length, 0);
});

test("a request for a model other than the session's gets no boundary request, and the next compaction re-arms", async (t) => {
  const { registry, compact, request } = setUp(t, BOUNDARY_CONFIG);
  await compact();
  await request(sessionPayload({ model: "another-model" }));
  await request();
  assert.equal(registry.sent.length, 0, "a skipped boundary request is not carried to the next request");
  await compact();
  await request();
  assert.equal(registry.sent.length, 1);
});

test("boundary without headers sends the boundary request with no added header", async (t) => {
  const { registry, compact, request } = setUp(t, { boundary: ["self-hosted"] });
  await compact();
  await request();
  assert.equal(registry.sent.length, 1);
  assert.deepEqual((await wireOf(registry.sent[0])).headers, {});
});

test("on the boundary request too, a header the provider's own config set wins", async (t) => {
  const { registry, compact, request } = setUp(t, BOUNDARY_CONFIG);
  await compact();
  await request();
  assert.deepEqual(await registry.sent[0].options.transformHeaders({ "X-Session-Id": "pinned" }), { "X-Session-Id": "pinned" });
});

// The real request is waiting behind the boundary request: no failure of it may reach pi.
for (const [name, answer] of [
  ["rejects", async () => { throw new Error("502 Bad Gateway"); }],
  ["throws before returning a promise", () => { throw new Error("no api key"); }],
] as const) {
  test(`a boundary request that ${name} lets the real request go out unchanged`, async (t) => {
    const { registry, compact, request } = setUp(t, BOUNDARY_CONFIG, { answer });
    await compact();
    assert.equal(await request(), undefined);
    assert.equal(registry.sent.length, 1);
  });
}

test("a boundary request that never answers is abandoned after its bound, and cancelled", { timeout: 5000 }, async (t) => {
  const { registry, compact, request } = setUp(t, BOUNDARY_CONFIG, { answer: () => new Promise(() => {}), timeoutMs: 20 });
  await compact();
  const started = Date.now();
  assert.equal(await request(), undefined);
  assert.ok(Date.now() - started < 1000, "the real request waited past the bound");
  assert.equal((registry.sent[0].options.signal as AbortSignal).aborted, true);
});

test("a user's abort of the run settles the boundary request at once, and cancels it", { timeout: 5000 }, async (t) => {
  const run = new AbortController();
  const { registry, compact, request } = setUp(t, BOUNDARY_CONFIG, { answer: () => new Promise(() => {}), signal: run.signal });
  await compact();
  const started = Date.now();
  const pending = request();
  setTimeout(() => run.abort(), 10);
  assert.equal(await pending, undefined);
  assert.ok(Date.now() - started < 1000, "the abort waited for the boundary request's own bound");
  assert.equal((registry.sent[0].options.signal as AbortSignal).aborted, true);
});

test("a run already aborted when the boundary request would start does not wait at all", { timeout: 5000 }, async (t) => {
  const run = new AbortController();
  run.abort();
  const { registry, compact, request } = setUp(t, BOUNDARY_CONFIG, { answer: () => new Promise(() => {}), signal: run.signal });
  await compact();
  const started = Date.now();
  await request();
  assert.ok(Date.now() - started < 1000);
  assert.equal((registry.sent[0].options.signal as AbortSignal).aborted, true);
});
