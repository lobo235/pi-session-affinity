# Changelog

All notable changes to pi-session-affinity are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) over the contract the README defines
(*Versioning*): the config file's name, location, keys, placeholder and validation rules, and the guarantees.
The boundary request is experimental and may change in a minor version.

## [Unreleased]

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
