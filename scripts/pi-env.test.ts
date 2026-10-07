/**
 * piEnv (pi-rpc.ts): the environment the smoke and the real-pi tests hand pi. It is an allowlist, so a key in the
 * environment of whoever runs the tests never reaches the pi they start.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { piEnv } from "./pi-rpc.ts";

const PARENT = { PATH: "/usr/bin", LANG: "C.UTF-8", TMPDIR: "/tmp/x", FAKE_API_KEY: "sentinel-key", OPENAI_API_KEY: "sentinel-openai", HOME: "/home/someone", PI_CODING_AGENT_DIR: "/home/someone/.pi/agent" };

test("piEnv: a key in the parent's environment is not passed on, and only allowlisted names are", () => {
  const env = piEnv("/scratch/root", "/scratch/root/agent", PARENT);
  assert.equal(env.FAKE_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH", "PI_CODING_AGENT_DIR", "PI_OFFLINE", "PI_SKIP_VERSION_CHECK", "PI_TELEMETRY", "TMPDIR"]);
});

test("piEnv: HOME and the agent dir are the smoke's own, never the parent's", () => {
  const env = piEnv("/scratch/root", "/scratch/root/agent", PARENT);
  assert.equal(env.HOME, "/scratch/root");
  assert.equal(env.PI_CODING_AGENT_DIR, "/scratch/root/agent");
});

test("piEnv: a child started with it does not see a sentinel set in this process", () => {
  process.env.FAKE_API_KEY = "sentinel-key";
  try {
    const seen = execFileSync(process.execPath, ["-e", "process.stdout.write(process.env.FAKE_API_KEY ?? 'absent')"], { env: piEnv("/scratch/root", "/scratch/root/agent") });
    assert.equal(seen.toString(), "absent");
  } finally {
    delete process.env.FAKE_API_KEY;
  }
});
