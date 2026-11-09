# Changelog

All notable changes to pi-session-affinity are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) over the contract the README defines
(*Versioning*): the config file's name, location, keys, placeholder and validation rules, and the guarantees.
The boundary request is experimental and may change in a minor version.

## [Unreleased]

## [v1.1.1] - 2026-11-09

### Security

- `load-smoke.mjs` replaced only the **first** `*` in an export target, and handed a
  specifier-derived string to `String.replace` as a replacement *pattern*, so a subpath containing
  `$&` or `` $` `` would be interpreted as a substitution. It now uses `replaceAll` with a function
  replacer, which fixes both halves (CodeQL `js/incomplete-sanitization`, high).

### Changed

- TypeScript 7.0.2, `@types/node`, and `actions/setup-node` 7.1.0 via Dependabot.

## [v1.1.0] - 2026-11-09

### Added

- A pi this package was not verified against now warns once per session, naming the pi and the verified release
  lines (1.2 through 1.5), instead of behaving unpredictably later. Anything learned before a context existed to
  notify through is queued and shown at session start.
- The pi internals this package reads (`getSessionId`, `modelRegistry.complete`) are feature-detected
  (`src/pi-guard.ts`): an internal pi moves or drops warns once, naming it, and that one feature degrades rather
  than the package failing to load. The Affinity header contract and the Boundary request are untouched.

### Changed

- Tested with pi 1.5.0, which the repository now vendors for its tests: the full suite passes there, plus the load
  smoke and a real-pi smoke. No behavioural change on verified release lines.

### Added

- A pi this package was not verified against now warns once per session, naming the pi and the verified release lines
  (1.2 through 1.5), and keeps working.
- The two pi internals the boundary request needs are feature-detected: a `getSessionId` or `modelRegistry.complete`
  that moved warns once, naming it, and costs only the boundary request's affinity key or the boundary request
  itself -- the real request still goes out.

### Changed

- The vendored `@earendil-works/pi-coding-agent` moves from 1.2.0 to 1.5.0, verified by the full suite (166 tests),
  the load smoke and the pi smoke.

## [v1.0.2] - 2026-10-13

### Changed

- Tested with pi 1.2.0, which the repository now vendors for its tests. No code changes.

## [v1.0.1] - 2026-10-10

### Changed

- Tested with pi 0.99.2, 1.0.0, 1.0.1, 1.0.2, 1.0.3, 1.0.4 and 1.1.0: the full suite and both smokes on each.
  The suite's vendored pi moves from 1.0.4 to 1.1.0. No code changes.
- Published from the release workflow through npm trusted publishing, so this version carries a provenance
  attestation linking it to its source commit. v1.0.0 was published by hand and has none.

## [v1.0.0] - 2026-10-10

### Added

- `session-affinity.json` in pi's agent dir, read fresh for every request: `headers` adds per-provider headers to
  every request of a session, with `{sessionId}` replaced by the pi session id. Empty by default: nothing is sent.
- The config file is validated whole; an invalid file sends nothing and is reported once, naming the file and the
  problem. A provider the file names that pi does not know, or one that lists virtual (routing) models, is a
  warning at session start.
- A session on a virtual (routing) model gets no headers and no boundary request, because pi does not say which
  provider the router picked.
- `boundary` (experimental): after each compaction, one one-token request ending at the request head, for
  hybrid-attention models on prefix-caching engines. Opt-in per provider, bounded at 120 seconds, cancelled by Esc.
  It carries pi's session id, which adds only pi's own affinity headers, never a change to the body.
- Tests: unit tests through the extension's events with in-memory fakes; a load smoke that loads the entry point
  through pi's own TypeScript transform and aliases; and a wire smoke that packs the package with `npm pack`,
  installs the unpacked tarball with the vendored pi's `pi install` (so pi finds it through `pi.extensions` and
  only the files the package ships), and checks what reaches a fake model on loopback.
- CI on Linux, macOS and Windows, a secret scan, a workflow security audit (zizmor), Dependabot updates and a package-contents check; a nightly run
  against the newest pi; npm publishing by trusted publishing, then a GitHub Release carrying the tag's changelog notes.
