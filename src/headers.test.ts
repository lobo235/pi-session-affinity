/**
 * applyAffinityHeaders (headers.ts): which configured headers a request gets.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { parseConfig, type AffinityConfig } from "./config.ts";
import { applyAffinityHeaders, type HeaderBag } from "./headers.ts";
import { SESSION_ID } from "./test-support.ts";

function configOf(raw: unknown): AffinityConfig {
  const result = parseConfig(JSON.stringify(raw));
  if ("problem" in result) throw new Error(result.problem);
  return result.config;
}

const CONFIG = configOf({ headers: { "example-gateway": { "x-session-id": "{sessionId}", "x-route": "pi-{sessionId}-{sessionId}", "x-client": "pi" } } });

for (const [name, incoming, provider, sessionId, expectedSet, expectedBag] of [
  ["a configured provider gets every header, each {sessionId} filled in", { authorization: "Bearer k" }, "example-gateway", SESSION_ID, ["x-session-id", "x-route", "x-client"],
    { authorization: "Bearer k", "x-session-id": SESSION_ID, "x-route": `pi-${SESSION_ID}-${SESSION_ID}`, "x-client": "pi" }],
  ["a session id set with --session-id is sent as it is", {}, "example-gateway", "my-session.1", ["x-session-id", "x-route", "x-client"],
    { "x-session-id": "my-session.1", "x-route": "pi-my-session.1-my-session.1", "x-client": "pi" }],
  ["a provider the config does not name is untouched", { a: "1" }, "example-provider", SESSION_ID, [], { a: "1" }],
  ["no provider is untouched", {}, undefined, SESSION_ID, [], {}],
  ["an inherited object member is not a configured provider", {}, "toString", SESSION_ID, [], {}],
  ["a header already set, in another letter case, wins", { "X-Session-Id": "theirs" }, "example-gateway", SESSION_ID, ["x-route", "x-client"],
    { "X-Session-Id": "theirs", "x-route": `pi-${SESSION_ID}-${SESSION_ID}`, "x-client": "pi" }],
  ["a header deleted with null stays deleted", { "x-client": null }, "example-gateway", SESSION_ID, ["x-session-id", "x-route"],
    { "x-client": null, "x-session-id": SESSION_ID, "x-route": `pi-${SESSION_ID}-${SESSION_ID}` }],
  ["an empty session id withholds only the headers that need one", {}, "example-gateway", "", ["x-client"], { "x-client": "pi" }],
  ["a session id with a space is withheld", {}, "example-gateway", "has space", ["x-client"], { "x-client": "pi" }],
  ["a header-injection attempt is withheld", {}, "example-gateway", "id\r\nx-evil: 1", ["x-client"], { "x-client": "pi" }],
  ["a character pi itself refuses is withheld", {}, "example-gateway", "abc/def", ["x-client"], { "x-client": "pi" }],
  ["an unbounded length is withheld", {}, "example-gateway", "a".repeat(129), ["x-client"], { "x-client": "pi" }],
  ["a non-string session id is withheld", {}, "example-gateway", 42, ["x-client"], { "x-client": "pi" }],
] as const) {
  test(`applyAffinityHeaders: ${name}`, () => {
    const bag: HeaderBag = { ...incoming };
    assert.deepEqual(applyAffinityHeaders(bag, CONFIG, { provider, sessionId }), expectedSet);
    assert.deepEqual(bag, expectedBag);
  });
}

test("applyAffinityHeaders: the longest well-formed session id (128 characters) is sent", () => {
  const sessionId = "a".repeat(128);
  const bag: HeaderBag = {};
  applyAffinityHeaders(bag, CONFIG, { provider: "example-gateway", sessionId });
  assert.equal(bag["x-session-id"], sessionId);
});

test("applyAffinityHeaders: a provider whose block is empty gets nothing", () => {
  const bag: HeaderBag = {};
  assert.deepEqual(applyAffinityHeaders(bag, configOf({ headers: { p: {} } }), { provider: "p", sessionId: SESSION_ID }), []);
  assert.deepEqual(bag, {});
});
