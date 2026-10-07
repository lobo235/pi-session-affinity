/**
 * The fake model (fake-model.ts) records only what pi's openai-completions API sends: anything else on its port,
 * such as a local service probing loopback ports, gets a 404 and is not counted as a model request.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { startFakeModel } from "./fake-model.ts";

for (const [name, method, route, recorded] of [
  ["a completion request is answered and recorded", "POST", "/v1/chat/completions", true],
  ["a port probe (GET /) gets a 404", "GET", "/", false],
  ["a GET on the completion route gets a 404", "GET", "/v1/chat/completions", false],
  ["a POST elsewhere gets a 404", "POST", "/v1/models", false],
  ["a POST with a query string is not the route", "POST", "/v1/chat/completions?x=1", false],
] as const) {
  test(`fakeModel: ${name}`, async (t) => {
    const fake = await startFakeModel("example-model");
    t.after(() => fake.server.close());
    const response = await fetch(`http://127.0.0.1:${fake.port}${route}`, {
      method,
      headers: { "user-agent": "Go-http-client/1.1", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      body: method === "POST" ? JSON.stringify({ model: "example-model", messages: [] }) : undefined,
    });
    await response.text();
    assert.equal(response.status, recorded ? 200 : 404);
    assert.equal(fake.requests().length, recorded ? 1 : 0);
  });
}
