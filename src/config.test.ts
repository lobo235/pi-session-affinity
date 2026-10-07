/**
 * The config file (config.ts): what a valid file means, and every way a file is refused.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { MAX_CONFIG_BYTES, parseConfig, readConfigFile } from "./config.ts";
import { tempDir, writeConfig } from "./test-support.ts";

test("parseConfig: headers keep their order and their templates; boundary is a set of provider names", () => {
  const result = parseConfig(JSON.stringify({
    headers: { "example-gateway": { "x-session-id": "{sessionId}", "x-client": "pi" }, "other.gw_1": {} },
    boundary: ["example-gateway", "self-hosted", "example-gateway"],
  }));
  assert.ok("config" in result, JSON.stringify(result));
  assert.deepEqual([...result.config.headers], [
    ["example-gateway", [{ name: "x-session-id", template: "{sessionId}" }, { name: "x-client", template: "pi" }]],
    ["other.gw_1", []],
  ]);
  assert.deepEqual([...result.config.boundary], ["example-gateway", "self-hosted"]);
});

test("parseConfig: an empty object, and either section alone, are valid", () => {
  for (const text of ["{}", '{"headers":{}}', '{"boundary":[]}', '{"boundary":["p"]}']) {
    assert.ok("config" in parseConfig(text), text);
  }
});

test("parseConfig: names that collide with object internals are ordinary provider names", () => {
  const result = parseConfig('{"headers":{"constructor":{"x-a":"1"},"toString":{"x-b":"2"}}}');
  assert.ok("config" in result);
  assert.deepEqual([...result.config.headers.keys()], ["constructor", "toString"]);
  assert.equal(result.config.headers.get("hasOwnProperty"), undefined);
});

// Every refusal names what is wrong and where, so the message alone is enough to fix the file.
for (const [name, text, expected] of [
  ["text that is not JSON", "{headers:", /not valid JSON/],
  ["an array at the top", "[]", /must be a JSON object/],
  ["null at the top", "null", /must be a JSON object/],
  ["an unknown top-level key (a typo)", '{"header":{}}', /unknown key "header"/],
  ["headers that is not an object", '{"headers":["p"]}', /"headers" must be an object/],
  ["a provider name with a space", '{"headers":{"my gateway":{}}}', /"my gateway" is not a provider name/],
  ["a URL instead of a provider name", '{"headers":{"https://gw.example.com/v1":{}}}', /is not a provider name/],
  ["a provider block that is not an object", '{"headers":{"p":"x-session-id"}}', /"headers"\."p" must be an object/],
  ["a header name with a space", '{"headers":{"p":{"x session":"v"}}}', /"x session" is not an HTTP header name/],
  ["a header name with a colon", '{"headers":{"p":{"x-a:":"v"}}}', /"x-a:" is not an HTTP header name/],
  ["the __proto__ header name", '{"headers":{"p":{"__proto__":"v"}}}', /"__proto__" cannot be configured/],
  ["a header the HTTP client owns", '{"headers":{"p":{"Content-Length":"1"}}}', /"Content-Length" cannot be configured/],
  ["a credential header", '{"headers":{"p":{"Authorization":"x"}}}', /"Authorization" cannot be configured/],
  ["a proxy header", '{"headers":{"p":{"proxy-authorization":"x"}}}', /"proxy-authorization" cannot be configured/],
  ["one header spelled twice in different case", '{"headers":{"p":{"X-A":"1","x-a":"2"}}}', /"X-A" and "x-a" are the same header/],
  ["a value that is a number", '{"headers":{"p":{"x-a":3}}}', /"headers"\."p"\."x-a" must be a string/],
  ["a value that is null", '{"headers":{"p":{"x-a":null}}}', /must be a string/],
  ["an empty value", '{"headers":{"p":{"x-a":""}}}', /must not be empty/],
  ["a value with a line break", '{"headers":{"p":{"x-a":"a\\r\\nx-evil: 1"}}}', /printable ASCII/],
  ["a value with a non-ASCII character", '{"headers":{"p":{"x-a":"caf\\u00e9"}}}', /printable ASCII/],
  ["an unknown placeholder (a typo)", '{"headers":{"p":{"x-a":"{session_id}"}}}', /"\{session_id\}".*only placeholder is \{sessionId\}/],
  ["a value longer than the bound", JSON.stringify({ headers: { p: { "x-a": "v".repeat(1025) } } }), /longer than 1024/],
  ["boundary that is not an array", '{"boundary":"p"}', /"boundary" must be an array/],
  ["a boundary entry that is not a string", '{"boundary":[1]}', /"boundary"\[0\]: 1 is not a provider name/],
  ["a boundary entry with a space", '{"boundary":["ok","bad name"]}', /"boundary"\[1\]: "bad name" is not a provider name/],
] as const) {
  test(`parseConfig refuses ${name}`, () => {
    const result = parseConfig(text);
    assert.ok("problem" in result, `accepted: ${text}`);
    assert.match(result.problem, expected);
  });
}

test("readConfigFile: a missing file is the empty config, not a problem", (t) => {
  const result = readConfigFile(path.join(tempDir(t), "session-affinity.json"));
  assert.ok("config" in result);
  assert.equal(result.config.headers.size + result.config.boundary.size, 0);
});

test("readConfigFile: a valid file is parsed", (t) => {
  const result = readConfigFile(writeConfig(tempDir(t), { boundary: ["p"] }));
  assert.ok("config" in result);
  assert.deepEqual([...result.config.boundary], ["p"]);
});

test("readConfigFile: every problem names the file", (t) => {
  const file = writeConfig(tempDir(t), "{not json");
  const result = readConfigFile(file);
  assert.ok("problem" in result);
  assert.ok(result.problem.startsWith(`${file}: `), result.problem);
});

test("readConfigFile: a directory in the file's place is a problem, not a crash", (t) => {
  const dir = path.join(tempDir(t), "session-affinity.json");
  fs.mkdirSync(dir);
  const result = readConfigFile(dir);
  assert.ok("problem" in result);
  assert.match(result.problem, /not a regular file/);
});

test("readConfigFile: a file larger than the bound is refused unread", (t) => {
  const file = writeConfig(tempDir(t), `{"headers":{}}${" ".repeat(MAX_CONFIG_BYTES)}`);
  const result = readConfigFile(file);
  assert.ok("problem" in result);
  assert.match(result.problem, new RegExp(`larger than ${MAX_CONFIG_BYTES} bytes`));
});

test("readConfigFile: a file that cannot be read is a problem naming the reason", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
  const file = writeConfig(tempDir(t), "{}");
  fs.chmodSync(file, 0o000);
  const result = readConfigFile(file);
  assert.ok("problem" in result);
  assert.match(result.problem, /cannot be read \(EACCES/);
});

for (const [name, content] of [["an empty file", ""], ["a file of whitespace", " \n\t\n"]] as const) {
  test(`readConfigFile: ${name} is the empty config`, (t) => {
    const result = readConfigFile(writeConfig(tempDir(t), content));
    assert.ok("config" in result);
    assert.equal(result.config.headers.size + result.config.boundary.size, 0);
  });
}
