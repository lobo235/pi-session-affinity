# Changelog

All notable changes to pi-session-affinity are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) over the contract the README defines
(*Versioning*): the config file's name, location, keys, placeholder and validation rules, and the guarantees.
The boundary request is experimental and may change in a minor version.

## [Unreleased]

### Added

- `session-affinity.json` in pi's agent dir, read fresh for every request: `headers` adds per-provider headers to
  every request of a session, with `{sessionId}` replaced by the pi session id. Empty by default: nothing is sent.
- The config file is validated whole; an invalid file sends nothing and is reported once, naming the file and the
  problem. A provider the file names that pi does not know is a warning at session start.
- `boundary` (experimental): after each compaction, one one-token request ending at the request head, for
  hybrid-attention models on prefix-caching engines. Opt-in per provider, bounded at 120 seconds, cancelled by Esc.
  It carries pi's session id, which adds only pi's own affinity headers, never a change to the body.
- Tests: unit tests through the extension's events with in-memory fakes, a load smoke through pi's own loader,
  and a wire smoke that drives the vendored pi against a fake model and checks what reaches the wire.
- CI on Linux and macOS (Windows allowed to fail), a secret scan and a package-contents check; a nightly run
  against the newest pi; npm publishing by trusted publishing.
