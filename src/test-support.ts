/**
 * In-memory fakes of the slice of pi's extension API this package uses. Shared by the tests; never shipped.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type Handler = (event: any, ctx: any) => unknown;

export const SESSION_ID = "0199a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b";

/** A fake pi: records handlers by event name; `emit` runs them in order and returns the last result. */
export function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
  const emit = async (event: string, payload: object, ctx: unknown): Promise<unknown> => {
    let result: unknown;
    for (const handler of handlers.get(event) ?? []) result = await handler({ type: event, ...payload }, ctx);
    return result;
  };
  return { pi, emit, registered: () => [...handlers.keys()] };
}

export interface SentRequest { model: unknown; context: unknown; options: any }

/** A fake model registry: the providers pi knows, and `complete`, which records each call and answers as told. */
export function fakeRegistry(options: { providers?: string[]; answer?: (call: SentRequest) => unknown } = {}) {
  const sent: SentRequest[] = [];
  const answer = options.answer ?? (async () => ({ role: "assistant", content: [], stopReason: "length" }));
  return {
    sent,
    getAll: () => (options.providers ?? []).map((provider) => ({ provider, id: "example-model" })),
    complete: (model: unknown, context: unknown, callOptions: unknown) => {
      const call = { model, context, options: callOptions };
      sent.push(call);
      return answer(call);
    },
  };
}

/** A fake event context: the session's model, its session id, a registry, and a UI that keeps what it was told. */
export function fakeCtx(options: {
  provider?: string;
  modelId?: string;
  sessionId?: () => unknown;
  registry?: ReturnType<typeof fakeRegistry>;
  hasUI?: boolean;
  signal?: AbortSignal;
} = {}) {
  const notices: Array<{ text: string; level: string | undefined }> = [];
  const ctx = {
    model: options.provider === undefined ? undefined : { provider: options.provider, id: options.modelId ?? "example-model" },
    sessionManager: { getSessionId: options.sessionId ?? (() => SESSION_ID) },
    modelRegistry: options.registry ?? fakeRegistry(),
    hasUI: options.hasUI ?? true,
    signal: options.signal,
    ui: { notify: (text: string, level?: string) => void notices.push({ text, level }) },
  };
  return { ctx, notices };
}

/** A private temporary directory for one test, removed when the test ends. */
export function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-affinity-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes `content` (JSON-encoded unless it is already a string) as the config file in `dir`; returns its path. */
export function writeConfig(dir: string, content: unknown): string {
  const file = path.join(dir, "session-affinity.json");
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}
