/**
 * A fake OpenAI-compatible chat-completions server on loopback for the wire smoke: answers each completion request
 * with one short streamed text reply, and records its headers and body. Anything else (another method or path,
 * such as a local service probing loopback ports with `GET /`) gets a 404 and is not recorded, so it can never
 * count as a model request.
 */
import * as http from "node:http";

import type { WireRequest } from "./wire-checks.ts";

/** The one route pi's openai-completions API posts to, given a provider baseUrl of `http://127.0.0.1:<port>/v1`. */
export const COMPLETION_ROUTE = "/v1/chat/completions";

function streamReply(res: http.ServerResponse, model: string, content: string): void {
  const chunk = (fields: object) => `data: ${JSON.stringify({ id: "smoke", object: "chat.completion.chunk", model, ...fields })}\n\n`;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write(chunk({ choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] }));
  res.write(chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } }));
  res.end("data: [DONE]\n\n");
}

export function startFakeModel(model: string): Promise<{ server: http.Server; port: number; requests: () => WireRequest[] }> {
  const recorded: WireRequest[] = [];
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== COMPLETION_ROUTE) {
      req.resume();
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = undefined; }
      recorded.push({ headers: { ...req.headers }, body });
      streamReply(res, model, "Done.");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port, requests: () => [...recorded] });
    });
  });
}
