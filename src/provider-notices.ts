/**
 * The session-start check: what is wrong with the providers the config names, given the models pi knows.
 */
import type { AffinityConfig } from "./config.ts";
import { VIRTUAL_MODEL_API } from "./headers.ts";

export interface CatalogModel {
  provider: string;
  api: string;
}

/** One warning per kind of problem, naming the file and the providers; empty when there is none. */
export function providerNotices(config: AffinityConfig, models: readonly CatalogModel[], file: string): string[] {
  const named = [...new Set([...config.headers.keys(), ...config.boundary])];
  const known = new Set(models.map((model) => model.provider));
  const withVirtual = new Set(models.filter((model) => model.api === VIRTUAL_MODEL_API).map((model) => model.provider));
  const quoted = (providers: string[]) => providers.map((provider) => JSON.stringify(provider)).join(", ");
  const unknown = named.filter((provider) => !known.has(provider));
  const virtual = named.filter((provider) => withVirtual.has(provider));
  const notices: string[] = [];
  // The typo that would otherwise fail silently: the session just runs slowly.
  if (unknown.length > 0) notices.push(`session-affinity: ${file} names ${quoted(unknown)}, which pi does not know as a provider, so nothing is ever sent for it`);
  if (virtual.length > 0) {
    notices.push(`session-affinity: ${file} names ${quoted(virtual)}, which lists virtual (routing) models; a session on one of them gets no headers and no boundary request, because pi does not say which provider the router picked`);
  }
  return notices;
}

