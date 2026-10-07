/**
 * Affinity headers: the configured headers for a session's provider, with `{sessionId}` filled in.
 *
 * Guarantees (README *What it guarantees*): a header the request already carries wins, whatever its letter case
 * and even when its value is null (pi's way of deleting one); a session id outside pi's own id shape is never
 * sent, and a header whose template needs one is withheld; nothing here throws, because it runs inside a request
 * the user is waiting on.
 */
import type { AffinityConfig } from "./config.ts";

export const SESSION_ID_PLACEHOLDER = "{sessionId}";

/** pi's rule for a session id (assertValidSessionId), plus a length bound: the value goes into an HTTP header. */
const SESSION_ID_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

export type HeaderBag = Record<string, string | null>;

/** pi's API id for a virtual model (pi's VIRTUAL_MODEL_API), kept here so an older pi without the export still loads. */
export const VIRTUAL_MODEL_API = "pi-virtual";

/**
 * The provider whose configuration a session's requests get, or undefined when none applies. A virtual (routing)
 * model routes each request to a physical model, possibly another provider's, while the session's model stays the
 * virtual one, and pi's header event does not say which model the router picked. Headers chosen by the virtual
 * model's provider could then reach any provider, so a virtual model gets nothing.
 */
export function affinityProviderOf(model: { provider: string; api: string } | undefined): string | undefined {
  if (model === undefined || model.api === VIRTUAL_MODEL_API) return undefined;
  return model.provider;
}

/** Who a request belongs to: the session's provider and its session id, as pi handed them over (untrusted). */
export interface AffinityRequest {
  provider: string | undefined;
  sessionId: unknown;
}

/** Adds the provider's configured headers to `headers`, in place, and returns the names it set. Never overwrites. */
export function applyAffinityHeaders(headers: HeaderBag, config: AffinityConfig, request: AffinityRequest): string[] {
  if (request.provider === undefined) return [];
  const wanted = config.headers.get(request.provider);
  if (wanted === undefined) return [];
  const present = new Set(Object.keys(headers).map((name) => name.toLowerCase()));
  const sessionId = typeof request.sessionId === "string" && SESSION_ID_SHAPE.test(request.sessionId) ? request.sessionId : undefined;
  const set: string[] = [];
  for (const { name, template } of wanted) {
    if (present.has(name.toLowerCase())) continue;
    if (template.includes(SESSION_ID_PLACEHOLDER) && sessionId === undefined) continue;
    headers[name] = template.split(SESSION_ID_PLACEHOLDER).join(sessionId ?? "");
    set.push(name);
  }
  return set;
}
