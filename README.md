# pi-session-affinity

**Keep one [pi](https://github.com/earendil-works/pi) conversation on one inference engine.**

A prompt cache belongs to one inference engine. When a gateway spreads one model across several engines and
picks one per request, a pi conversation that moves to another engine pays for its whole prompt again: at 50k
tokens that can be 20 seconds before the first token. Many gateways can keep a conversation on one engine if
every request names its session in a header, but pi's `models.json` headers are static, so they cannot carry a
per-session value. This extension adds the headers you configure, with pi's session id filled in, to every
request of a session on the providers you name. It also has an experimental **boundary request**, for
self-hosted hybrid-attention models, that keeps the prompt head reusable after a compaction.

With no configuration it does nothing. It registers no tools, no commands and no prompt text.

## Do you need it?

You probably do if you run your own model servers, or a gateway in front of several replicas of one model,
and that gateway can route by a session header. For example:

- [LiteLLM](https://docs.litellm.ai/docs/routing) with session affinity on (`optional_pre_call_checks:
  ["session_affinity"]`) reads `x-litellm-session-id`;
- the [vLLM production-stack](https://github.com/vllm-project/production-stack) router with
  `--routing-logic session` reads the header you name in `--session-key`;
- any gateway or load balancer that can hash or pin on a request header.

You do not need it if:

- **one engine serves your model.** There is nothing to route between. (The boundary request may still help;
  see below.)
- **you use a hosted API** (Anthropic, OpenAI, Google and the like). Their prompt caches are keyed and routed on
  their side.
- **your gateway already reads one of the headers pi can send on its own.** With
  `compat.sendSessionAffinityHeaders: true` in `models.json`, pi's `openai-completions` and `anthropic-messages`
  models send the session id in a fixed set of headers (`x-session-affinity`, `x-client-request-id`,
  `session_id` or `x-session-id`, depending on the API and `compat.sessionAffinityFormat`). pi's
  `openai-responses` models send `x-client-request-id` (and `session_id` or `x-session-id`) whatever
  `compat.sendSessionAffinityHeaders` says, unless prompt caching is off. If one of those works for your gateway,
  use it and skip this extension's `headers`.

Measured on a self-hosted model behind LiteLLM with session affinity, balancing two vLLM engines, over one real
conversation of 12 requests whose prompt grew from 54k to 82k tokens:

|                            | without the header | with it   |
| -------------------------- | ------------------ | --------- |
| Engine switches            | 5                  | 0         |
| Tokens prefilled           | 78,938             | 31,626    |
| …of which recomputed       | 51,483             | 4,136     |
| Median time to first token | 7.5 s              | 1.5 s     |
| Worst time to first token  | 28.9 s             | 7.7 s     |

## Install

```bash
pi install npm:pi-session-affinity
```

Then create the config file (below) and start a new pi session. Requirements: Node.js 22.19 or newer (pi's own
requirement). Linux, macOS and Windows are tested.

## Configuration

One file: `session-affinity.json` in pi's agent dir (`~/.pi/agent/session-affinity.json`, or under
`PI_CODING_AGENT_DIR`). There is no project-level configuration, so a repository you open cannot add headers to
your requests. There are no environment variables.

```json
{
  "headers": {
    "example-gateway": { "x-session-id": "{sessionId}" }
  },
  "boundary": []
}
```

| key | default | meaning |
| --- | --- | --- |
| `headers` | `{}` | `{"<provider>": {"<header>": "<template>"}}`. Every request of a session whose model belongs to `<provider>` (a provider name from `models.json` or pi's built-in list, matched exactly) gets each header. `{sessionId}` in a template is replaced by the pi session id; it is the only placeholder. A template without it is sent as written. |
| `boundary` | `[]` | Provider names whose sessions get a boundary request after each compaction. **Experimental**; see *The boundary request*. Independent of `headers`. |

**Header values are not secret.** Every header is sent on every request of a session on that provider, so put
no credential in a template; pi's provider configuration is the place for keys.

The file is read again for every request, so an edit applies to the next request without restarting pi. No
file, an empty file, or `{}` means nothing is sent and no boundary request is made.

**Validation.** The file is checked whole. If anything in it is wrong, nothing at all is sent until it is
fixed, and pi shows one error naming the file and the problem (on standard error in print and JSON modes).
Partial use would send some headers and not others, which is harder to notice than nothing. The checks:

- only the keys `headers` and `boundary`;
- provider names of letters, digits, `.`, `_` and `-`, starting with a letter or digit;
- header names that are valid HTTP field names, each spelled once (names are case-insensitive);
- no header the HTTP client, transport or credentials own: `authorization`, `cookie`, `host`, `connection`,
  `keep-alive`, `te`, `trailer`, `transfer-encoding`, `upgrade`, the key headers `x-api-key`, `api-key`,
  `x-litellm-api-key`, `x-goog-api-key` and `anthropic-api-key`, any `content-*` or `proxy-*` header, and
  `__proto__`;
- values that are non-empty strings of printable ASCII and spaces (so no line breaks), at most 1024 characters,
  with no placeholder other than `{sessionId}` (a typo such as `{session_id}` is an error, not a literal);
- the file at most 64 KiB.

When a session starts, a provider named in the file that pi does not know is reported as a warning: that is the
typo that would otherwise mean the session just runs slowly. So is a provider that lists virtual (routing) models,
which never get anything (see *Known issues*).

## Turning it off

- **Everything:** delete `session-affinity.json`, or empty it (or make it `{}`). Like any edit, this applies from
  the next request, with no restart.
- **Only the boundary request:** set `"boundary": []` and keep `headers`.
- **Uninstall:** `pi remove npm:pi-session-affinity`. pi processes started after that no longer load it.

## What it guarantees

- **Only the providers you name get anything.** Every other request is left exactly as pi built it.
- **A header that is already set wins.** If the provider's `models.json` headers, pi itself or another extension
  already set the same header, in any letter case, even to `null` (pi's way of removing one), it is kept.
- **A malformed session id is never sent.** The id must match pi's own rule for one (letters, digits, `.`, `_`
  and `-`, alphanumeric at both ends) and be at most 128 characters. Otherwise the headers whose templates need
  it are left out, and the others are still sent.
- **It never fails a request.** Whatever pi hands the extension, the request goes out, at worst without its
  headers.

The session id is the one pi shows in `/session`. A resumed session (`-c`, `-r`) keeps it, so it returns to the
engine that still holds its cache, and so does moving to another branch with `/tree`, which stays in the same
session file. `/new`, `/fork` and `/clone` start a new session with a new id, so their requests may land on
another engine; a fork or clone that shares a long history with the old session pays for it once there. pi's
own compaction requests carry the headers too (the wire smoke checks every request). A compaction extension that calls the model registry directly does not go through pi's header event, so its
requests do not; [Longhaul](https://github.com/lobo235/pi-longhaul) has its own `summarizerHeaders` setting, with
the same shape, for exactly this.

## The boundary request

**Experimental.** Opt in per provider with `boundary`. It may change in a minor release.

**Why it exists.** Some self-hosted models are hybrid-attention models: most of their layers are linear attention
or state-space layers (Mamba-style), with full attention in between, as in the Qwen3-Next and Qwen3.5 class. A
prefix-caching engine can resume such a model's prompt only at a point where it saved the recurrent state, and in
practice it keeps that state reliably only at the **last full cache block of each request**: the states inside a
long request are retired as prefill moves past them and are evicted first. Every normal request in a coding
session ends far past the prompt head (system prompt and tools). After a compaction pi rewrites the conversation
behind that head, so nothing reusable sits where the head ends, and the first request after the compaction
prefills the entire head again, often 30k tokens that were sent a hundred times before.

**What it does.** After a compaction, before the first request goes out, the extension sends one extra request
to the same model: that request's own system message, tools and settings, a user turn of `"."`, and a limit of
one output token, carrying your configured headers and pi's session id. It ends exactly where the head ends, so
the engine keeps a restart point there, and the real request resumes from it.

**Why the compaction summary is left out.** A hybrid engine resumes only from a restart point at the end of a
request. A head that held the summary would end somewhere new after every compaction, because the summary changes
each time, so every boundary request would find no restart point and prefill the whole head cold. A head of just
the system message and tools is the same at every compaction, so each boundary request resumes from the restart
point the previous one left and costs well under a second, and the real request then prefills only the summary
and what follows it.

Passing pi's session id only adds pi's own session-affinity headers (when the model's
`compat.sendSessionAffinityHeaders` is on); it never changes the request body, and a test pins that.

Measured on a hybrid 27B model on vLLM with prefix caching, a 35k-token head, pi 1.0.4, two compactions:

|                                       | without           | with the boundary request |
| ------------------------------------- | ----------------- | ------------------------- |
| First request after a compaction      | 5,936 of 34,871 tokens cached | 30,528 of 34,745 (first), 30,528 of 51,548 (second) |
| The boundary request itself           | —                 | 30,528 cached, 0.7–0.9 s  |

**Who benefits:** self-hosted hybrid-attention models on a prefix-caching engine (measured on vLLM), directly or
behind a gateway. **Who does not:** plain transformer models, whose engines can reuse any cached
block of a prefix (the head is reused without help), and hosted APIs, whose caches work differently. On those it
only adds a request.

**What it costs.** One extra request per compaction, with a one-token answer. When the previous state survived
it is a sub-second cache hit; when it was evicted it prefills the head cold, which is the work the real request
would otherwise have done itself. On a paid provider it is billed like any other request.

**How to check it works.** Look at the cached tokens of the first request after a compaction. pi records them
as `cacheRead` in the usage of each assistant message in the session file; vLLM reports them as
`usage.prompt_tokens_details.cached_tokens` when started with `--enable-prompt-tokens-details`. With the boundary
request they should cover about the whole head; without it, they are near zero on a hybrid model.

**Its rules.** Only providers listed in `boundary` get one, only after a compaction that succeeded, and only for
the first request after it. Only a chat-completions request led by a system message has a head to send (pi's
`openai-completions` API); other APIs are skipped. A request for a model other than the session's is skipped.
The output limit keeps the name the request already uses (`max_tokens` or `max_completion_tokens`), and the real
request is never changed. The real request waits for the boundary request, but never past 120 seconds: a boundary
request that fails is ignored, one that has not answered by then is cancelled, and pressing Esc cancels it at
once. It goes through pi's model registry, which does not fire pi's request events, so it cannot trigger itself.

## pi versions

Built and tested on pi 1.0.4. It uses only pi's public extension events (`session_start`, `session_compact`,
`before_provider_headers`, `before_provider_request`) and the context's model registry, with no imports from pi's
internals, so it does not check pi's version at run time. A nightly CI job tests it against the newest pi on npm
and opens an issue when that fails; failures are listed under *Known issues* until fixed.

## Known issues

- **The provider is the session's, not the request's.** pi's header event does not say which model a request is
  for, so the extension uses the session's current model. A request pi sends to another provider during a session
  (from an extension that calls a second model, for example) is judged by the session's.
- **Sessions on a virtual (routing) model get nothing.** A virtual model hands each request to a model it picks,
  possibly on another provider, and pi does not tell the header event which one. Rather than send one provider's
  headers to another, the extension adds no headers and makes no boundary request while the session's model is
  virtual, and warns at session start when the config names a provider that lists virtual models.
- **Child pi processes started with `--no-extensions`** (some subagent extensions do this) send no headers.
- **Compaction extensions that call the model registry directly** do not get the headers (see *What it
  guarantees*).
- **The boundary request supports chat-completions payloads only.** Anthropic Messages and OpenAI Responses
  requests are skipped.

## Versioning

This package follows [Semantic Versioning](https://semver.org). The contract is the config file: its name and
location, the `headers` key and its meaning, the `{sessionId}` placeholder, the validation rules, and the
guarantees above. Removing or changing any of these is a major version. The boundary request is experimental:
its behaviour may change in a minor version until it is declared stable. The TypeScript modules are not an API;
importing them from another package is unsupported. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## More

- [CHANGELOG.md](CHANGELOG.md): what changed in each version.
- [CONTRIBUTING.md](https://github.com/lobo235/pi-session-affinity/blob/main/CONTRIBUTING.md), [SECURITY.md](https://github.com/lobo235/pi-session-affinity/blob/main/SECURITY.md), [CODE_OF_CONDUCT.md](https://github.com/lobo235/pi-session-affinity/blob/main/CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
