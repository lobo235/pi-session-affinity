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

- **The pull request title** becomes the squash commit's subject: `area: summary`, in the imperative or as a
  statement of the new behaviour (`render: keep the Goal line once the Request moves`).
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

`npm test` must pass. The wire smoke in it packs the package (`npm pack`), installs the unpacked tarball with
the vendored pi's `pi install` into a temporary agent dir, and drives pi in RPC mode against a fake model on
loopback, so a wrong `pi.extensions` entry or a file missing from `files` fails it. It needs no network and no
key, and pi gets only an allowlisted environment (`PATH`, temp dir, locale), so your own keys never reach it. CI runs everything on Linux, macOS and Windows (pi is started as `node` on its own entry script, never through
npm's `.cmd` shim), a secret scan, a security audit of the workflows (zizmor), and a check of what the package would publish (`npm run check-pack`).

## A new pi version

The extension uses only pi's public extension events, so there is no list of verified versions. A nightly job
tests it against the newest pi on npm and opens an issue when that fails. To check one by hand: set the exact
version of `@earendil-works/pi-coding-agent` in `devDependencies`, `npm install`, and `npm test`.

## Releasing (maintainers)

1. Set `version` in `package.json` (and the lockfile: `npm install --package-lock-only`). A version with a
   `-` (`1.0.0-rc.1`) is published under the `next` dist-tag, anything else under `latest`. Point `pi.image` in `package.json` at the new tag too: the release job checks it.
2. Rename `## [Unreleased]` in `CHANGELOG.md` to `## [vX.Y.Z] - YYYY-MM-DD`, with the `v`: the release job
   checks for it. Put a fresh empty `## [Unreleased]` above it.
3. Merge to `main`, tag that commit `vX.Y.Z`, and push the tag. `release.yml` re-runs the tests and the package
   check, then waits in the `npm` environment for a maintainer's approval and publishes with provenance.

The first publish of a new package cannot go through the workflow: npm configures a trusted publisher only for a
package that already exists. It is a manual `npm publish --access public` with two-factor authentication, from
a clean checkout of the tag after `npm ci && npm test && npm run check-pack`. Right after it: configure the
trusted publisher on npmjs.com (this repository, workflow `release.yml`, environment `npm`), set the package to
require two-factor authentication and disallow tokens, and delete any token used. A trusted publisher
configuration that has not published within two days expires, so the next release should follow soon or the
configuration be made again.


**Where a release shows up.** The [pi package gallery](https://pi.dev/packages) lists the package from npm within
minutes of a publish: its card shows the `package.json` `description` and the `pi.image` card
(`.github/assets/card.png`, pinned to the release tag), and its page renders the README inside the published
tarball. Editing either on GitHub changes nothing there until the next release, and a README link to a file the
package does not ship must be an absolute GitHub URL. After `publish`, `release.yml` creates the GitHub Release
for the tag from its `CHANGELOG.md` section; for the manual first publish, run
`gh release create vX.Y.Z --verify-tag --title vX.Y.Z --notes-file <that section>` instead. The repository's
social preview (Settings > General) is `.github/assets/social-preview.png`, uploaded by hand.

## Repository settings (maintainers)

The workflows and docs rely on:


- an `npm` environment with required reviewers (without them, "waits for a maintainer's approval" is false) and
  a deployment rule limited to `v*` tags, and a ruleset that protects `v*` tags and `main` (required checks, no
  force push);
- the `main` ruleset requires a pull request approved by a code owner (`.github/CODEOWNERS`), with its review threads
  resolved and a linear history (squash or
  rebase merges), and every CI check: the `test` legs, `workflows` and `secrets`. Maintainers can bypass it;
- Dependabot alerts and security updates, plus the weekly version updates in `.github/dependabot.yml`; CodeQL
  default setup, whose high and critical alerts block a merge; secret scanning with push protection;
- Issues enabled (the nightly job opens one when the newest pi fails);
- Discussions (the issue template links to them) and private vulnerability reporting (SECURITY.md does);
- GitHub pauses scheduled workflows in a repository with no activity for 60 days; re-enable `nightly-pi` from
  the Actions tab when that happens.

## Licence

MIT. By opening a pull request you agree your contribution is licensed under the same terms (inbound =
outbound). There is no CLA and no sign-off requirement.

## Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
