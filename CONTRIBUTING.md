# Contributing to pi-session-affinity

Thank you for helping. This file says how a change gets in. Coding agents: [AGENTS.md](AGENTS.md) has the same
rules in a shorter form.

## Before you write code

**Open an issue first** for anything larger than a typo or a one-line fix. Say what you saw, what you expected,
and what you would change. The extension is small on purpose (per-session headers and the boundary request), and
an issue saves you writing a pull request that cannot be merged.

Bug reports: include your `session-affinity.json` with provider names and values replaced by placeholders, and
your pi version. **Never paste a transcript, a raw request, a session id or your gateway's address.**

Security problems: not in an issue. See [SECURITY.md](SECURITY.md).

## Setting up

```bash
git clone https://github.com/lobo235/pi-session-affinity && cd pi-session-affinity
npm ci          # Node >= 22.19
npm test        # typecheck, unit tests, load smoke, wire smoke
```

To try a change in your own pi: `pi install /path/to/pi-session-affinity` (a local path install), then start a
new pi session. `pi remove /path/to/pi-session-affinity` undoes it.

## Making the change

- **Tests first**, one behaviour at a time, through the extension's events or the exported function. Fakes over
  mocks: `src/test-support.ts` has a fake pi, context and model registry.
- **Table-driven** for anything with branches, with names that say what each row means.
- **Fixtures are synthetic.** No real transcript, request, session id, hostname, IP address or key, even redacted.
  Use `example-gateway`, `example.com` and invented ids.
- **Small pieces**: functions under 60 lines, files under 400.
- **Docs in the same pull request**: the README for behaviour or configuration, and a line in `CHANGELOG.md`
  under `## [Unreleased]`.
- A change that weakens a guarantee in the README (*What it guarantees*) or the validation rules says so in the
  pull request.

`npm test` must pass. The wire smoke in it starts the vendored pi in RPC mode against a fake model on loopback;
it needs no network and no key. CI runs everything on Linux and macOS, plus a secret scan and a check of what
the package would publish (`npm run check-pack`).

## A new pi version

The extension uses only pi's public extension events, so there is no list of verified versions. A nightly job
tests it against the newest pi on npm and opens an issue when that fails. To check one by hand: set the exact
version of `@earendil-works/pi-coding-agent` in `devDependencies`, `npm install`, and `npm test`.

## Licence

MIT. By opening a pull request you agree your contribution is licensed under the same terms (inbound =
outbound). There is no CLA and no sign-off requirement.

## Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
