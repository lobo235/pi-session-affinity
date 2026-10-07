/**
 * The wire smoke's verdict over the requests the fake model recorded (wire-smoke.ts): null when the extension did
 * its job, else the first thing that was wrong.
 */

export interface WireRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

type ChatBody = { messages?: Array<{ role?: string; content?: unknown }>; max_tokens?: number; max_completion_tokens?: number };

const bodyOf = (request: WireRequest): ChatBody => (typeof request.body === "object" && request.body !== null ? (request.body as ChatBody) : {});

function isBoundary(request: WireRequest): boolean {
  const body = bodyOf(request);
  const messages = body.messages ?? [];
  const cap = body.max_tokens ?? body.max_completion_tokens;
  return messages.length === 2 && messages[0]?.role === "system" && messages[1]?.role === "user" && messages[1]?.content === "." && cap === 1;
}

function headerProblem(request: WireRequest, which: string, header: string, sessionId: string): string | null {
  const value = request.headers[header];
  if (value === sessionId) return null;
  return `the ${which} carried ${header}: ${JSON.stringify(value ?? null)}, expected the session id`;
}

export function checkWire(requests: readonly WireRequest[], expected: { header: string; sessionId: string }): string | null {
  if (!expected.sessionId) return "pi reported no session id";
  if (requests.length === 0) return "no first request reached the model";
  const firstProblem = headerProblem(requests[0], "first request", expected.header, expected.sessionId);
  if (firstProblem) return firstProblem;
  const boundaryIndex = requests.findIndex(isBoundary);
  if (boundaryIndex < 0) return "no boundary request reached the model after the compaction";
  const boundaryProblem = headerProblem(requests[boundaryIndex], "boundary request", expected.header, expected.sessionId);
  if (boundaryProblem) return boundaryProblem;
  const real = requests[boundaryIndex + 1];
  if (real === undefined) return "no request after the boundary request reached the model";
  const boundaryHead = JSON.stringify(bodyOf(requests[boundaryIndex]).messages?.[0]);
  if (JSON.stringify(bodyOf(real).messages?.[0]) !== boundaryHead) return "the request after the boundary request has a different head (system message)";
  return headerProblem(real, "request after the boundary request", expected.header, expected.sessionId);
}
