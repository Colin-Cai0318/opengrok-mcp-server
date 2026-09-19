# Upstream sync audit (2026-09-19)

## Repository relationship

- Downstream: `Colin-Cai0318/opengrok-mcp-server`, reviewed at `6d9876a` (9.3.1).
- Upstream: `IcyHot09/opengrok-mcp-server`, reviewed at `a97583c` (9.6.0 plus release/docs follow-ups).
- Merge base: `f216f521f74550d5dfb5410823ebb76ae5ad4364`.
- Downstream delta at review start: 41 files changed, 1,706 insertions, 6,236 deletions.

The downstream is intentionally a Web-only build for customized OpenGrok deployments. It removes
SCM/history/annotate/diff/call-graph and unreliable REST surfaces, narrows schemas and prompts to
the supported tool set, and adds named connection configuration. Those deletions are product
constraints, not an accidental lag behind upstream.

## Upstream-only commits

| Commit | Decision | Reason |
| --- | --- | --- |
| `a1d8545` — 9.6.0 architecture/security/features | Do not merge or cherry-pick as a unit | It rewrites 196 files (28k additions), restores tools and REST/SCM behavior deliberately removed downstream, splits most server modules, changes sandbox limits and APIs, and makes several dependency major-version jumps. A direct merge would erase the Web-only boundary and make review impractical. |
| `2c42f91` — skip npm publish if version exists | Defer | Useful release hardening, but its registry check targets the upstream unscoped package name. Port separately with `@colin-cai0318/opengrok-mcp-server` when the downstream release workflow is next changed. |
| `a97583c` — README label change | Do not port | Upstream-only wording with no runtime or downstream documentation value. |

## 9.6.0 items that should be ported separately

These are valuable but need focused downstream changes and regression tests rather than a bulk merge:

1. Upgrade direct dependencies that currently require major versions for security fixes (`undici`,
   `vitest`, `@toon-format/toon`, and `js-yaml`). The review-time `npm audit` reports 26 findings
   (2 critical, 14 high, 8 moderate, 2 low); `npm audit fix` has no compatible in-range fix.
2. Replace native/global `fetch` plus an external Undici dispatcher with a consistently imported
   Undici fetch/dispatcher pair, then re-run proxy, TLS, redirect, and credential-leak tests.
3. Port authority-scoped credential stripping on redirects and response-body draining behavior.
4. Evaluate the larger sandbox buffer/timeout hardening independently against the downstream's
   reduced Web-only API.
5. Consider atomic credential/config writes and no-clobber background synchronization in a CLI/
   extension-specific change.

## Changes included in this downstream update

- The existing named-connections file is extended into single-process, multi-server project routing.
- Every configured server is queried for projects before MCP connects.
- Duplicate project names and partial discovery failures fail fast instead of guessing a route.
- Cross-server searches fan out by project owner; project-scoped reads, symbols, directories,
  dependency traversal, and xref resource links use the owning server URL.
- Cookie/password values remain environment references (`cookieEnv`/`passwordEnv`) rather than
  command-line or JSON secrets.
- Stale tests for deliberately removed upstream tools are removed or updated to the actual Web-only
  surface, restoring meaningful full-suite validation.

## Recommended future sync strategy

Keep `upstream/main` as a fetch-only review remote. For each upstream release, classify commits into:

1. Web-only-compatible security/correctness fixes — port with focused tests.
2. SCM/REST/tool-surface changes — reject unless the downstream product constraint changes.
3. Pure refactors — take only when they reduce the cost of future ports and can be reviewed in
   small slices.
4. Release/docs changes — adapt package names and downstream behavior explicitly; never cherry-pick
   registry or installation text blindly.
