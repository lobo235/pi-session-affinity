/**
 * pi-session-affinity: keep one pi conversation on one inference engine.
 *
 * Two independent, opt-in behaviours, both configured in `session-affinity.json` in pi's agent dir (config.ts):
 *
 *   - `headers`: on every request of a session whose provider is listed, add that provider's headers, with
 *     `{sessionId}` replaced by the pi session id (headers.ts). A gateway that routes by a session key then keeps
 *     the conversation on the engine that already holds its prompt cache.
 *   - `boundary` (experimental): after each compaction, one extra one-token request that ends exactly at the
 *     request head, for hybrid-attention engines (boundary.ts).
 *
 * With no file, or an empty one, the extension does nothing. It registers no tools, commands or prompt text.
 *
 * Known limit: pi's `before_provider_headers` event carries no model, so the provider is the session's model
 * (`ctx.model`), not the request's. In pi 1.0.x every request of the agent loop runs on the session's model.
 */
import * as path from "node:path";

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerBoundaryRequest } from "./boundary.ts";
import { CONFIG_FILE_NAME, type AffinityConfig } from "./config.ts";
import { createConfigReader } from "./config-reader.ts";
import { applyAffinityHeaders } from "./headers.ts";
import { notifyUser, writeProcessStderr, type WriteStderr } from "./notice.ts";

/** Seams for tests; pi calls the factory with `pi` alone, which means the defaults. */
export interface SessionAffinityOptions {
  /** Where the config file is; default `<agentDir>/session-affinity.json`, asked of pi at every read. */
  configPath?: () => string;
  /** Where a notice goes when the session has no UI; default process.stderr. */
  writeStderr?: WriteStderr;
  /** How long the next request waits for a boundary request; default DEFAULT_BOUNDARY_TIMEOUT_MS. */
  boundaryTimeoutMs?: number;
}

function readOrUndefined<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Providers the config names that pi does not know: the typo that would otherwise fail silently. */
function unknownProviders(config: AffinityConfig, knownProviders: ReadonlySet<string>): string[] {
  const named = new Set([...config.headers.keys(), ...config.boundary]);
  return [...named].filter((provider) => !knownProviders.has(provider));
}

export default function sessionAffinity(pi: ExtensionAPI, options: SessionAffinityOptions = {}): void {
  const writeStderr = options.writeStderr ?? writeProcessStderr;
  const configPath = options.configPath ?? (() => path.join(getAgentDir(), CONFIG_FILE_NAME));
  const readConfig = createConfigReader(configPath, writeStderr);

  pi.on("session_start", (_event, ctx) => {
    const config = readConfig(ctx);
    const models = readOrUndefined(() => ctx.modelRegistry.getAll());
    if (config === undefined || models === undefined) return;
    const unknown = unknownProviders(config, new Set(models.map((model) => model.provider)));
    if (unknown.length === 0) return;
    const names = unknown.map((provider) => JSON.stringify(provider)).join(", ");
    const file = readOrUndefined(configPath) ?? CONFIG_FILE_NAME;
    notifyUser(ctx, `session-affinity: ${file} names ${names}, which pi does not know as a provider, so nothing is ever sent for it`, "warning", writeStderr);
  });

  pi.on("before_provider_headers", (event, ctx) => {
    const config = readConfig(ctx);
    if (config === undefined) return;
    applyAffinityHeaders(event.headers, config, { provider: ctx.model?.provider, sessionId: readOrUndefined(() => ctx.sessionManager.getSessionId()) });
  });

  registerBoundaryRequest(pi, { readConfig, ...(options.boundaryTimeoutMs === undefined ? {} : { timeoutMs: options.boundaryTimeoutMs }) });
}
