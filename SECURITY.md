# Security policy

## Reporting a vulnerability

Report it privately through GitHub: the repository's **Security** tab, then **Report a vulnerability**. Do not
open a public issue, discussion or pull request for it.

Include the pi-session-affinity and pi versions, what an attacker controls, and what they gain. A minimal
synthetic config file or request that shows it is ideal. **Do not send real transcripts, requests, session ids or
keys**; if the problem only shows on real data, describe its shape instead.

You should get an acknowledgement within 7 days. A fix is released as a patch version, and the advisory is
published once a fixed version is available, crediting you unless you prefer otherwise.

## Supported versions

The latest release.

## Scope

In scope: anything where this extension itself turns input into harm. For example:

- a header or session id reaching a provider the config file does not name;
- a value from the config file or from pi (the session id) injecting a second header, a line break or anything
  else into a request;
- a header this extension adds replacing one the provider's configuration, pi or another extension already set,
  or a credential or framing header;
- a config file, a malformed session id or a failing boundary request that crashes pi, fails a request, or holds
  a request up past the documented bound;
- a repository you open changing what is sent (there is no project-level configuration by design).

Out of scope: pi itself and other extensions (report those to their projects), a gateway's or model provider's
handling of what it is sent, and a user who configures a header on purpose.
