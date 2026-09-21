# Team deployment bundle

`template/` contains the credential-free Linux deployment layout for the internal V/W/X routed OpenGrok configuration.

Create the local, gitignored team configuration once:

```bash
cp deploy/team/team-config.example.json deploy/team/team-config.local.json
# Edit team-config.local.json with the internal V/W/X URLs and V/W proxy.
```

Then build a distributable ZIP from the current committed source with one command:

```bash
npm run package:team-deploy
```

The default output is:

```text
dist/team-deploy/opengrok-mcp-team-deploy-<npm-version>-routing.<git-sha>.zip
```

Set an explicit deployment version when preparing a named Canary or release:

```bash
npm run package:team-deploy -- --version 1.1.0-routing-canary
```

The packager requires a clean working tree by default so `SOURCE_COMMIT` accurately identifies every bundled source file. `--allow-dirty` exists only for developing and testing the packaging workflow.

Internal endpoints are injected from `team-config.local.json` at package time. That file is ignored by Git so company URLs and proxy addresses are not committed to the public repository. An alternative config path can be supplied with `--team-config <path>`.

The generated archive contains:

- a tarball built from the current OpenGrok MCP commit;
- connection-level V/W proxy and X direct configuration;
- the rootless Cookie Helper and Chrome extension;
- one routed VS Code/HyperCode MCP registration;
- a live routing smoke test and intranet verification checklist;
- file-level and ZIP-level SHA256 checksums.

Never add generated `helper.token`, `cookies.json`, `opengrok.env`, `*.cookie`, or a machine-bound `generated-config.js` to the template.
