@AGENTS.md

## Integration Surface & Consumers

What pi-session-affinity exposes, and who depends on it. The README's *Versioning* section is the SemVer
contract.

**Exposes**

- The npm package `pi-session-affinity`: the pi extension entry `src/index.ts` (`package.json`
  `pi.extensions`). The TypeScript modules are not an importable API.
- The config file `session-affinity.json` in pi's agent dir: its name and location, the `headers` key, the
  `{sessionId}` placeholder, and the validation rules (reserved headers, name and value limits, whole-file
  refusal). No environment variables.
- The HTTP headers it adds to a configured provider's requests, valued from the pi session id.
- The `boundary` key and the boundary request after each compaction: experimental, may change in a minor
  version.

**Consumers**

- pi users who install the package, and the gateways or servers they configure it for (anything that routes by
  a header, such as LiteLLM's session affinity).
- Longhaul's `summarizerHeaders`, which sends the same header shape on the compaction's own calls; the README
  points to it, so a change to the shape is a change there too.
- The maintainer's private operations repo carries an in-tree copy of this extension and a pre-push guard for
  this clone, and the maintainer's own gateway routes by its header; a contract change is also a change there.
- Docs: README (*Configuration*, *The boundary request*, *Versioning*), `CHANGELOG.md`.
