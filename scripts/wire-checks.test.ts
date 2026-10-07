/**
 * checkWire (wire-checks.ts): the wire smoke's verdict over recorded requests, on synthetic recordings.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { checkWire, type WireRequest } from "./wire-checks.ts";

const ID = "0199a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b";
const SYSTEM = { role: "system", content: "You are a coding agent." };
const session = (messages: object[], headers: Record<string, string> = { "x-session-id": ID }): WireRequest => ({
  headers, body: { model: "m", messages: [SYSTEM, ...messages], max_tokens: 4096, stream: true },
});
const boundary = (headers: Record<string, string> = { "x-session-id": ID }): WireRequest => ({
  headers, body: { model: "m", messages: [SYSTEM, { role: "user", content: "." }], max_tokens: 1, stream: true },
});
const summarizer: WireRequest = { headers: {}, body: { model: "m", messages: [{ role: "system", content: "Summarize." }, { role: "user", content: "the conversation" }], max_tokens: 2000 } };
const first = session([{ role: "user", content: "first" }]);
const second = session([{ role: "user", content: "summary" }, { role: "user", content: "second" }]);

for (const [name, requests, sessionId, expected] of [
  ["a correct recording", [first, summarizer, boundary(), second], ID, null],
  ["no session id from pi", [first, summarizer, boundary(), second], "", /no session id/],
  ["no requests at all", [], ID, /first request/],
  ["a first request without the header", [session([{ role: "user", content: "first" }], {}), summarizer, boundary(), second], ID, /first request.*x-session-id/],
  ["a header with another value", [session([{ role: "user", content: "first" }], { "x-session-id": "other" }), summarizer, boundary(), second], ID, /first request.*"other"/],
  ["no boundary request", [first, summarizer, second], ID, /no boundary request/],
  ["a boundary request without the header", [first, summarizer, boundary({}), second], ID, /boundary request.*x-session-id/],
  ["no request after the boundary request", [first, summarizer, boundary()], ID, /no request after the boundary request/],
  ["a real request whose head differs", [first, summarizer, boundary(), { ...second, body: { ...(second.body as object), messages: [{ role: "system", content: "changed" }] } }], ID, /head/],
  ["a real request without the header", [first, summarizer, boundary(), session([{ role: "user", content: "second" }], {})], ID, /request after the boundary request.*x-session-id/],
] as const) {
  test(`checkWire: ${name}`, () => {
    const verdict = checkWire([...requests] as WireRequest[], { header: "x-session-id", sessionId });
    if (expected === null) assert.equal(verdict, null);
    else assert.match(verdict ?? "", expected);
  });
}
