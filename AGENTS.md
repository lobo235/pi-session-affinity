# Working on pi-session-affinity (for coding agents)

pi-session-affinity is an extension for the pi coding agent: it adds configured per-session headers to a
session's provider requests, and (experimental) sends one boundary request after each compaction. Human
contributors: [CONTRIBUTING.md](CONTRIBUTING.md) says the same with more context. Behaviour and configuration are
documented in [README.md](README.md); keep it true.

## Commands

```bash
npm ci                 # Node >= 22.19; installs the vendored pi as a devDependency
npm test               # typecheck + unit tests + load smoke + wire smoke; must pass before any commit
npm run typecheck      # tsc only
node --test src/config.test.ts   # one file
npm run smoke -- --verbose       # the wire smoke alone, one line per request (no content)
npm run check-pack     # what npm would publish: nothing test-only, nothing missing
```

## Layout

- `src/index.ts`: the extension entry (events, the session-start warning).
- `src/config.ts`: the config file and its validation; `src/config-reader.ts`: fresh reads and reporting once.
- `src/headers.ts`: which headers a request gets. `src/boundary.ts`: the boundary request.
- `src/notice.ts`: how a message reaches the user. `src/test-support.ts`: fakes for the tests (not shipped).
- `scripts/`: the wire smoke, its fake model and checks, and the package check. `load-smoke.mjs`: pi's loader.

## Invariants (do not break these)

1. **Nothing is sent without configuration.** No default provider, header or boundary request, ever. No
   environment variable or project-level file may add one.
2. **An invalid config file is refused whole** and reported once; the extension then does nothing.
3. **A header already on the request wins**, in any letter case, even when null.
4. **A malformed session id is never sent**, and nothing reaches a header value that is not printable ASCII.
5. **The extension never fails or blocks a request.** Every handler catches; the boundary request is bounded and
   follows the run's abort signal.
6. **Only public pi API.** No imports from pi's internals outside tests; there is no run-time pi version check.
7. **Fixtures are synthetic.** Never commit a real transcript, request, session id, hostname, IP address or key.

## How to change code

- Test first, one behaviour at a time, through the extension's events or an exported function. Use the fakes in
  `src/test-support.ts`, not mocks that assert call order.
- Functions stay under 60 lines and files under 400. Split by responsibility when one grows.
- Update docs in the same change: README (configuration, behaviour) and `CHANGELOG.md` under `## [Unreleased]`.
- Do not bump the version; that is a release step.
