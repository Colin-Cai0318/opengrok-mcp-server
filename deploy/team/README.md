# Team deployment bundle

`template/` contains the credential-free Linux deployment layout for routed OpenGrok connections. The archive enables `lx-` connections by default and includes the remaining connections as optional entries.

Create the local, gitignored team configuration once:

```bash
cp deploy/team/team-config.example.json deploy/team/team-config.local.json
# Edit team-config.local.json with the proxy URLs keyed by proxyEnv.
cp /path/to/connection.json deploy/team/team-connections.local.json
# Keep the complete connection catalog in this gitignored local file.
```

Then build a distributable ZIP from the current committed source with one command:

```bash
npm run package:team-deploy
```

The default output is:

```text
dist/team-deploy/opengork-mcp-v<npm-version>.zip
```

Set an explicit deployment version when preparing a named Canary or release:

```bash
npm run package:team-deploy -- --version 9.4.1
```

The packager requires a clean working tree by default so `SOURCE_COMMIT` accurately identifies every bundled source file. `--allow-dirty` exists only for developing and testing the packaging workflow.

Proxy settings are injected from `team-config.local.json` at package time. Its `network` object maps each `proxyEnv` to a URL; the old `vwProxy` field remains supported. That file is ignored by Git so company proxy addresses are not committed to the public repository. An alternative config path can be supplied with `--team-config <path>`.

The full connection catalog comes from `team-connections.local.json` (or `--connections-file <path>`). The packager validates each URL and cookie environment variable, includes all entries in `connections.catalog.json`, and enables only the `lx-` entries in `connections.json`. Installed users add or remove optional entries with `~/.local/bin/manage-opengrok-connections.py`.

The existing `lq-` location prefix groups the LC sites. Add LC-A17 to the local catalog as `lq-opengrok-android-x` with its own `LQ_OPENGROK_COOKIE_X`, `direct=true`, and `verifySsl=true`; then `add lq` enables both LC-W and LC-A17. Keep actual intranet URLs in the gitignored catalog, not in this public repository.

The generated archive contains:

- a tarball built from the current OpenGrok MCP commit;
- connection-level proxy and direct configuration;
- the rootless Cookie Helper and Chrome extension;
- one routed VS Code/HyperCode MCP registration;
- a live routing smoke test and concise deployment README;
- file-level and ZIP-level SHA256 checksums.

Never add generated `helper.token`, `cookies.json`, `opengrok.env`, `*.cookie`, or a machine-bound `generated-config.js` to the template.
