/**
 * The boundary request (experimental; README *The boundary request*): before the first request after a
 * compaction, send the engine a one-token request whose prompt is that request's head (its system message, tools
 * and settings) plus a one-character user turn, so the engine keeps a resumable state where the head ends and the
 * real request reuses it instead of prefilling the head cold.
 *
 * Why: a hybrid-attention engine (linear attention or state-space layers beside full attention) can resume a
 * prompt only where it saved the recurrent state, and keeps that state reliably only at a request's last full
 * block. Every ordinary request ends far past the head, so after a compaction rewrites the conversation nothing
 * reusable sits at the head's end.
 *
 * The head deliberately stops at the system message and leaves the compaction summary out: the head is then the
 * same at every compaction, so each boundary request re-hits the state the previous one left. A head that ended
 * after the summary would change at every compaction and prefill cold each time.
 *
 * Designed twice:
 *   A. send from `session_compact` with a head rebuilt from the session (rejected: the head pi really sends next
 *      can differ, and a near-miss head caches nothing);
 *   B. arm on `session_compact`, send the next request's own head from `before_provider_request` (picked: the
 *      head is exact by construction, and pi awaits both events, so the order is guaranteed).
 * pi's model registry does not run `before_provider_request`, so the boundary request cannot re-arm itself.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ConfigReader } from "./config-reader.ts";
import { applyAffinityHeaders, type HeaderBag } from "./headers.ts";

const BOUNDARY_USER_TURN = { role: "user", content: "." } as const;

/**
 * Generous on purpose: the boundary request prefills only the head, work the real request would otherwise do
 * itself, so waiting for it costs almost nothing; giving up early would waste the wait. A cold head of 35k tokens
 * on a busy engine can take 30-60 s.
 */
export const DEFAULT_BOUNDARY_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A system message with text (a string or content parts): the only lead a request head has. */
function isSystemMessage(message: unknown): boolean {
  if (!isRecord(message) || message.role !== "system") return false;
  return typeof message.content === "string" || (Array.isArray(message.content) && message.content.length > 0);
}

/**
 * The head of `payload` as a one-token request, or undefined when the payload is not a chat-completions request
 * led by a system message. The payload itself is never changed.
 */
export function buildBoundaryPayload(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.messages) || !isSystemMessage(payload.messages[0])) return undefined;
  // Cap the output under the name the request already uses: a second cap could be rejected.
  const capName = "max_completion_tokens" in payload ? "max_completion_tokens" : "max_tokens";
  return { ...payload, messages: [payload.messages[0], BOUNDARY_USER_TURN], [capName]: 1 };
}

/**
 * Settles when the call settles, the bound passes or the run is aborted, whichever is first; on either of the last
 * two, cancels the call. The run's signal matters because pi awaits this handler: without it a user's Esc would
 * wait out the bound while the engine kept prefilling a request nobody wants.
 */
export async function boundedCall(call: (signal: AbortSignal) => Promise<unknown>, timeoutMs: number, runSignal: AbortSignal | undefined): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => controller.abort();
  const stopped = new Promise<void>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(), { once: true });
    timer = setTimeout(cancel, timeoutMs);
    if (runSignal?.aborted) cancel();
    else runSignal?.addEventListener("abort", cancel, { once: true });
  });
  try {
    await Promise.race([Promise.resolve().then(() => call(controller.signal)), stopped]);
  } finally {
    clearTimeout(timer);
    runSignal?.removeEventListener("abort", cancel);
  }
}

export interface BoundaryOptions {
  readConfig: ConfigReader;
  /** How long the real request waits behind the boundary request; default DEFAULT_BOUNDARY_TIMEOUT_MS. */
  timeoutMs?: number;
}

type ProviderRequestContext = Parameters<Parameters<ExtensionAPI["on"]>[1]>[1];

/** Sends the boundary request for `payload` if one applies; resolves when it is answered, bounded or aborted. */
async function sendBoundaryRequest(payload: unknown, ctx: ProviderRequestContext, options: BoundaryOptions): Promise<void> {
  const model = ctx.model;
  if (model === undefined) return;
  const config = options.readConfig(ctx);
  if (config === undefined || !config.boundary.has(model.provider)) return;
  const boundary = buildBoundaryPayload(payload);
  // The head belongs to the model the request names; sending it with the session's model would cache nothing useful.
  if (boundary === undefined || boundary.model !== model.id) return;
  const sessionId = ctx.sessionManager.getSessionId();
  const transformHeaders = (headers: HeaderBag) => {
    const next = { ...headers };
    applyAffinityHeaders(next, config, { provider: model.provider, sessionId });
    return next;
  };
  await boundedCall(
    (signal) => ctx.modelRegistry.complete(model, { systemPrompt: "", messages: [] }, { maxTokens: 1, signal, sessionId, onPayload: () => boundary, transformHeaders }),
    options.timeoutMs ?? DEFAULT_BOUNDARY_TIMEOUT_MS,
    ctx.signal,
  );
}

/**
 * Arms on `session_compact`, which pi awaits before the run continues; fires from the first
 * `before_provider_request` after it, which pi also awaits, so the boundary request is answered before the real
 * request is sent. The real request's payload is never changed (the handler returns undefined).
 */
export function registerBoundaryRequest(pi: Pick<ExtensionAPI, "on">, options: BoundaryOptions): void {
  let armed = false;
  pi.on("session_compact", () => {
    armed = true;
  });
  pi.on("before_provider_request", async (event, ctx) => {
    if (!armed) return undefined;
    armed = false;
    try {
      await sendBoundaryRequest(event.payload, ctx, options);
    } catch {
      // A failed boundary request costs only the reuse it was for; the real request must still go out.
    }
    return undefined;
  });
}
