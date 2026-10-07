/**
 * The config file: `session-affinity.json` in pi's agent dir (README *Configuration*).
 *
 *   { "headers": { "<provider>": { "<header>": "<template>" } }, "boundary": ["<provider>", ...] }
 *
 * Validated whole, at the boundary: a file with any problem is refused as a whole, with one message naming the
 * file and the problem, and the extension then does nothing. A partial reading would send some headers and not
 * others, which is harder to notice than nothing at all. No file, or an empty one, is the empty config.
 */
import * as fs from "node:fs";

export const CONFIG_FILE_NAME = "session-affinity.json";

/** The file is read on every request; a bound keeps a mistake (a log redirected here) from costing every request. */
export const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_TEMPLATE_CHARS = 1024;

export interface HeaderTemplate {
  name: string;
  template: string;
}

export interface AffinityConfig {
  /** Provider name -> the headers to add to its requests, in file order. */
  headers: ReadonlyMap<string, readonly HeaderTemplate[]>;
  /** Providers that get a boundary request after a compaction (boundary.ts). */
  boundary: ReadonlySet<string>;
}

export type ConfigResult = { config: AffinityConfig } | { problem: string };

const EMPTY_CONFIG: AffinityConfig = { headers: new Map(), boundary: new Set() };
const TOP_LEVEL_KEYS = new Set(["headers", "boundary"]);
const PROVIDER_NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** RFC 9110 token: what an HTTP field name may contain. */
const HEADER_NAME_SHAPE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** Visible ASCII and spaces only: a template can never carry a line break or a non-ASCII byte into a request. */
const TEMPLATE_SHAPE = /^[\x20-\x7e]+$/;
const PLACEHOLDER_SHAPE = /\{[^{}]*\}/g;
/**
 * Headers the HTTP client, the transport or the provider's credentials own. Setting one could break every
 * request or replace a credential, and no routing key needs one. `__proto__` is a valid token, but assigning it
 * to a header object reaches the prototype setter.
 */
const RESERVED_HEADERS = new Set(["__proto__", "authorization", "connection", "cookie", "host", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade", "x-api-key", "api-key", "x-litellm-api-key", "x-goog-api-key", "anthropic-api-key"]);
const RESERVED_HEADER_PREFIXES = ["content-", "proxy-"];

type Parsed<T> = { value: T } | { problem: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const providerProblem = (where: string, name: unknown) =>
  `${where}${JSON.stringify(name)} is not a provider name (letters, digits, ".", "_" and "-", starting with a letter or digit, as in models.json)`;

function isReservedHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return RESERVED_HEADERS.has(lower) || RESERVED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function templateProblem(where: string, template: unknown): string | undefined {
  if (typeof template !== "string") return `${where} must be a string`;
  if (template === "") return `${where} must not be empty`;
  if (!TEMPLATE_SHAPE.test(template)) return `${where} may contain only printable ASCII characters and spaces`;
  if (template.length > MAX_TEMPLATE_CHARS) return `${where} is longer than ${MAX_TEMPLATE_CHARS} characters`;
  const unknown = (template.match(PLACEHOLDER_SHAPE) ?? []).find((placeholder) => placeholder !== "{sessionId}");
  if (unknown !== undefined) return `${where} uses ${JSON.stringify(unknown)}; the only placeholder is {sessionId}`;
  return undefined;
}

function headerNameProblem(where: string, name: string, seen: Map<string, string>): string | undefined {
  if (!HEADER_NAME_SHAPE.test(name)) return `${where}: ${JSON.stringify(name)} is not an HTTP header name`;
  if (isReservedHeader(name)) return `${where}: ${JSON.stringify(name)} cannot be configured (the HTTP client, the transport or the provider's credentials own it)`;
  const earlier = seen.get(name.toLowerCase());
  if (earlier !== undefined) return `${where}: ${JSON.stringify(earlier)} and ${JSON.stringify(name)} are the same header (names are case-insensitive)`;
  seen.set(name.toLowerCase(), name);
  return undefined;
}

function parseHeaderBlock(provider: string, block: unknown): Parsed<HeaderTemplate[]> {
  const where = `"headers".${JSON.stringify(provider)}`;
  if (!isObject(block)) return { problem: `${where} must be an object of header name to value` };
  const seen = new Map<string, string>();
  const templates: HeaderTemplate[] = [];
  for (const [name, template] of Object.entries(block)) {
    const problem = headerNameProblem(where, name, seen) ?? templateProblem(`${where}.${JSON.stringify(name)}`, template);
    if (problem !== undefined) return { problem };
    templates.push({ name, template: template as string });
  }
  return { value: templates };
}

function parseHeaders(raw: unknown): Parsed<Map<string, HeaderTemplate[]>> {
  if (raw === undefined) return { value: new Map() };
  if (!isObject(raw)) return { problem: `"headers" must be an object of provider name to header object` };
  const headers = new Map<string, HeaderTemplate[]>();
  for (const [provider, block] of Object.entries(raw)) {
    if (!PROVIDER_NAME_SHAPE.test(provider)) return { problem: providerProblem(`"headers": `, provider) };
    const parsed = parseHeaderBlock(provider, block);
    if ("problem" in parsed) return parsed;
    headers.set(provider, parsed.value);
  }
  return { value: headers };
}

function parseBoundary(raw: unknown): Parsed<Set<string>> {
  if (raw === undefined) return { value: new Set() };
  if (!Array.isArray(raw)) return { problem: `"boundary" must be an array of provider names` };
  const providers = new Set<string>();
  for (const [index, provider] of raw.entries()) {
    if (typeof provider !== "string" || !PROVIDER_NAME_SHAPE.test(provider)) return { problem: providerProblem(`"boundary"[${index}]: `, provider) };
    providers.add(provider);
  }
  return { value: providers };
}

/** The config a file's text describes, or the first problem with it. */
export function parseConfig(text: string): ConfigResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { problem: `is not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  if (!isObject(raw)) return { problem: "must be a JSON object" };
  const unknownKey = Object.keys(raw).find((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknownKey !== undefined) return { problem: `unknown key ${JSON.stringify(unknownKey)} (expected "headers" or "boundary")` };
  const headers = parseHeaders(raw.headers);
  if ("problem" in headers) return headers;
  const boundary = parseBoundary(raw.boundary);
  if ("problem" in boundary) return boundary;
  return { config: { headers: headers.value, boundary: boundary.value } };
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Reads and validates `file`. A missing file is the empty config; every problem is prefixed with the file's path. */
export function readConfigFile(file: string): ConfigResult {
  let text: string;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { problem: `${file}: is not a regular file` };
    if (stat.size > MAX_CONFIG_BYTES) return { problem: `${file}: is larger than ${MAX_CONFIG_BYTES} bytes` };
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { config: EMPTY_CONFIG };
    return { problem: `${file}: cannot be read (${errorText(error)})` };
  }
  if (text.trim() === "") return { config: EMPTY_CONFIG };
  const result = parseConfig(text);
  return "problem" in result ? { problem: `${file}: ${result.problem}` } : result;
}
