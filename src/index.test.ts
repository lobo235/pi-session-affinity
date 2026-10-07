/**
 * The extension as pi drives it: the config file, the per-request headers, and what it reports.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import sessionAffinity from "./index.ts";
import { SESSION_ID, fakeCtx, fakePi, fakeRegistry, tempDir, writeConfig } from "./test-support.ts";

const GATEWAY_CONFIG = { headers: { "example-gateway": { "x-session-id": "{sessionId}" } } };

/** Loads the extension against `configFile` and returns a function that sends one request's headers through it. */
function load(configFile: string, stderr: string[] = []) {
  const { pi, emit } = fakePi();
  sessionAffinity(pi as any, { configPath: () => configFile, writeStderr: (text) => void stderr.push(text) });
  const send = async (ctx: unknown, headers: Record<string, string | null> = {}) => {
    await emit("before_provider_headers", { headers }, ctx);
    return headers;
  };
  return { emit, send };
}

test("a request to a configured provider carries its header, with {sessionId} filled in", async (t) => {
  const { send } = load(writeConfig(tempDir(t), GATEWAY_CONFIG));
  const headers = await send(fakeCtx({ provider: "example-gateway" }).ctx);
  assert.deepEqual(headers, { "x-session-id": SESSION_ID });
});

test("with no config file, nothing is sent", async (t) => {
  const { send } = load(path.join(tempDir(t), "session-affinity.json"));
  assert.deepEqual(await send(fakeCtx({ provider: "example-gateway" }).ctx, { "x-kept": "1" }), { "x-kept": "1" });
});

for (const [name, content] of [
  ["an empty object", {}],
  ["empty sections", { headers: {}, boundary: [] }],
] as const) {
  test(`a config file with ${name} sends nothing`, async (t) => {
    const { send } = load(writeConfig(tempDir(t), content));
    assert.deepEqual(await send(fakeCtx({ provider: "example-gateway" }).ctx), {});
  });
}

test("a request to any other provider is left exactly as pi built it", async (t) => {
  const { send } = load(writeConfig(tempDir(t), GATEWAY_CONFIG));
  assert.deepEqual(await send(fakeCtx({ provider: "example-provider" }).ctx, { "x-kept": "1" }), { "x-kept": "1" });
});

test("a session with no model yet sends nothing", async (t) => {
  const { send } = load(writeConfig(tempDir(t), GATEWAY_CONFIG));
  assert.deepEqual(await send(fakeCtx().ctx), {});
});

// The handler runs inside a request the user is waiting on: whatever pi hands it, the request goes out.
for (const [name, sessionId] of [
  ["throws", () => { throw new Error("no session"); }],
  ["returns nothing", () => undefined],
  ["returns a non-string", () => 42],
  ["returns a malformed id", () => "bad id\r\nx-evil: 1"],
] as const) {
  test(`a session manager that ${name} costs the request its header, never the request`, async (t) => {
    const { send } = load(writeConfig(tempDir(t), GATEWAY_CONFIG));
    assert.deepEqual(await send(fakeCtx({ provider: "example-gateway", sessionId }).ctx, { "x-kept": "1" }), { "x-kept": "1" });
  });
}

test("the config file is read again for every request, so an edit applies without a restart", async (t) => {
  const dir = tempDir(t);
  const file = writeConfig(dir, {});
  const { send } = load(file);
  const { ctx } = fakeCtx({ provider: "example-gateway" });
  assert.deepEqual(await send(ctx), {});
  writeConfig(dir, GATEWAY_CONFIG);
  assert.deepEqual(await send(ctx), { "x-session-id": SESSION_ID });
});

test("an invalid config file sends nothing, and is reported once, naming the file and the problem", async (t) => {
  const file = writeConfig(tempDir(t), { headers: { "example-gateway": { "x-session-id": "{session_id}" } } });
  const { send } = load(file);
  const { ctx, notices } = fakeCtx({ provider: "example-gateway" });
  assert.deepEqual(await send(ctx), {});
  assert.deepEqual(await send(ctx), {});
  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, "error");
  assert.ok(notices[0].text.includes(file), notices[0].text);
  assert.match(notices[0].text, /\{session_id\}/);
  assert.match(notices[0].text, /nothing is sent/i);
});

test("an invalid config file is valid again once fixed, and a new problem is reported again", async (t) => {
  const dir = tempDir(t);
  const file = writeConfig(dir, "{broken");
  const { send } = load(file);
  const { ctx, notices } = fakeCtx({ provider: "example-gateway" });
  await send(ctx);
  writeConfig(dir, GATEWAY_CONFIG);
  assert.deepEqual(await send(ctx), { "x-session-id": SESSION_ID });
  writeConfig(dir, "{broken");
  await send(ctx);
  assert.equal(notices.length, 2, "the same problem after a fix is news again");
});

test("without a UI (print mode), a problem goes to stderr instead", async (t) => {
  const stderr: string[] = [];
  const { send } = load(writeConfig(tempDir(t), "[]"), stderr);
  const { ctx, notices } = fakeCtx({ provider: "example-gateway", hasUI: false });
  await send(ctx);
  await send(ctx);
  assert.equal(notices.length, 0);
  assert.equal(stderr.length, 1);
  assert.match(stderr[0], /^session-affinity: .*must be a JSON object.*\n$/);
});

/** A session start against `configFile`, with pi knowing `providers`; returns what the user was told. */
async function startSession(configFile: string, providers: string[] | "throws", hasUI = true) {
  const stderr: string[] = [];
  const { emit } = load(configFile, stderr);
  const registry = fakeRegistry({ providers: providers === "throws" ? [] : providers });
  if (providers === "throws") registry.getAll = () => { throw new Error("registry not ready"); };
  const { ctx, notices } = fakeCtx({ registry, hasUI });
  await emit("session_start", { reason: "startup" }, ctx);
  return { notices, stderr };
}

test("a provider the config names but pi does not know is called out when the session starts", async (t) => {
  const file = writeConfig(tempDir(t), { headers: { "exmaple-gateway": { "x-session-id": "{sessionId}" } }, boundary: ["example-gateway", "self-hostd"] });
  const { notices } = await startSession(file, ["example-gateway", "example-provider"]);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, "warning");
  assert.match(notices[0].text, /"exmaple-gateway", "self-hostd"/);
  assert.ok(notices[0].text.includes(file));
});

test("a session whose configured providers are all known starts without a notice", async (t) => {
  const file = writeConfig(tempDir(t), { headers: GATEWAY_CONFIG.headers, boundary: ["example-gateway"] });
  assert.deepEqual((await startSession(file, ["example-gateway"])).notices, []);
});

test("an invalid config file is reported when the session starts, before any request", async (t) => {
  const { notices } = await startSession(writeConfig(tempDir(t), '{"header":{}}'), ["example-gateway"]);
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /unknown key "header"/);
});

test("a session start that cannot list providers still starts, silently", async (t) => {
  const { notices, stderr } = await startSession(writeConfig(tempDir(t), GATEWAY_CONFIG), "throws");
  assert.deepEqual([notices, stderr], [[], []]);
});

test("a config path pi cannot give is reported once, and nothing is sent", async () => {
  const { pi, emit } = fakePi();
  sessionAffinity(pi as any, { configPath: () => { throw new Error("no agent dir"); }, writeStderr: () => {} });
  const { ctx, notices } = fakeCtx({ provider: "example-gateway" });
  const headers = {};
  await emit("before_provider_headers", { headers }, ctx);
  await emit("before_provider_headers", { headers }, ctx);
  assert.deepEqual(headers, {});
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /cannot locate the config file \(no agent dir\)/);
});

test("the extension registers only the events it needs: no tools, no commands", () => {
  const { pi, registered } = fakePi();
  sessionAffinity(pi as any);
  assert.deepEqual(registered().sort(), ["before_provider_headers", "before_provider_request", "session_compact", "session_start"]);
});
