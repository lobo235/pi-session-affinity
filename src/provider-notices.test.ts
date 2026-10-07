/**
 * providerNotices (provider-notices.ts): the session-start warnings about the providers the config names.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { parseConfig, type AffinityConfig } from "./config.ts";
import { providerNotices } from "./provider-notices.ts";

function configOf(raw: unknown): AffinityConfig {
  const result = parseConfig(JSON.stringify(raw));
  if ("problem" in result) throw new Error(result.problem);
  return result.config;
}

const MODELS = [
  { provider: "example-gateway", api: "openai-completions" },
  { provider: "example-router", api: "pi-virtual" },
  { provider: "mixed", api: "openai-completions" },
  { provider: "mixed", api: "pi-virtual" },
];

for (const [name, raw, expected] of [
  ["every provider known and physical", { headers: { "example-gateway": {} }, boundary: ["example-gateway"] }, []],
  ["an empty config", {}, []],
  ["an unknown provider in headers", { headers: { "exmaple-gateway": {} } }, [/"exmaple-gateway", which pi does not know/]],
  ["unknown providers in both sections, named once each", { headers: { a: {} }, boundary: ["a", "b"] }, [/names "a", "b", which pi does not know/]],
  ["a provider of virtual models only", { boundary: ["example-router"] }, [/"example-router", which lists virtual \(routing\) models/]],
  ["a provider with both physical and virtual models", { headers: { mixed: {} } }, [/"mixed", which lists virtual/]],
  ["one unknown and one virtual", { headers: { nope: {}, "example-router": {} } }, [/"nope", which pi does not know/, /"example-router", which lists virtual/]],
] as const) {
  test(`providerNotices: ${name}`, () => {
    const notices = providerNotices(configOf(raw), MODELS, "/agent/session-affinity.json");
    assert.equal(notices.length, expected.length, notices.join("\n"));
    expected.forEach((pattern, index) => {
      assert.match(notices[index], pattern);
      assert.ok(notices[index].includes("/agent/session-affinity.json"));
    });
  });
}
