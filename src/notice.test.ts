/**
 * notifyUser (notice.ts): where a message goes, and that delivering it never throws.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { notifyUser } from "./notice.ts";

test("notifyUser: a session with a UI gets a pi notification at the given level", () => {
  const shown: unknown[] = [];
  const stderr: string[] = [];
  notifyUser({ hasUI: true, ui: { notify: (text, level) => void shown.push([text, level]) } }, "hello", "warning", (text) => void stderr.push(text));
  assert.deepEqual([shown, stderr], [[["hello", "warning"]], []]);
});

test("notifyUser: a session without a UI gets one line on stderr", () => {
  const stderr: string[] = [];
  notifyUser({ hasUI: false, ui: { notify: () => assert.fail("notify in a session without a UI") } }, "hello", "error", (text) => void stderr.push(text));
  assert.deepEqual(stderr, ["hello\n"]);
});

test("notifyUser: a notify that throws is swallowed, not raised into pi's event", () => {
  assert.doesNotThrow(() => notifyUser({ hasUI: true, ui: { notify: () => { throw new Error("ui gone"); } } }, "hello", "error", () => {}));
});
