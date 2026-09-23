#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_DIR="${ROOT}/deploy/team/template"
OUTPUT_DIR="${ROOT}/dist/team-deploy"
TEAM_CONFIG="${ROOT}/deploy/team/team-config.local.json"
CONNECTIONS_SOURCE="${ROOT}/deploy/team/team-connections.local.json"
DEPLOY_VERSION=""
ALLOW_DIRTY=0

usage() {
  cat <<'USAGE'
Usage: scripts/package-team-deploy.sh [options]

Build a credential-free, one-click Linux deployment ZIP for the routed
OpenGrok V/W/X team configuration.

Options:
  --version <version>      Deployment bundle version. Defaults to
                           the current npm package version.
  --output-dir <path>      Output directory. Defaults to dist/team-deploy.
  --team-config <path>     Non-secret internal URL/proxy configuration. Defaults
                           to deploy/team/team-config.local.json (gitignored).
  --connections-file <path>  Full connection catalog. Defaults to
                           deploy/team/team-connections.local.json (gitignored).
  --allow-dirty            Allow packaging an uncommitted working tree.
                           Intended only for local package-script development.
  -h, --help               Show this help.
USAGE
}

while (($#)); do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || { echo "--version requires a value" >&2; exit 2; }
      DEPLOY_VERSION="$2"
      shift 2
      ;;
    --output-dir)
      [[ $# -ge 2 ]] || { echo "--output-dir requires a value" >&2; exit 2; }
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --team-config)
      [[ $# -ge 2 ]] || { echo "--team-config requires a value" >&2; exit 2; }
      TEAM_CONFIG="$2"
      shift 2
      ;;
    --connections-file)
      [[ $# -ge 2 ]] || { echo "--connections-file requires a value" >&2; exit 2; }
      CONNECTIONS_SOURCE="$2"
      shift 2
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

for command_name in git node npm python3 zip unzip; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command not found: $command_name" >&2
    exit 1
  }
done
[[ -d "$TEMPLATE_DIR" ]] || { echo "Deployment template missing: $TEMPLATE_DIR" >&2; exit 1; }

cd "$ROOT"
[[ -r "$TEAM_CONFIG" ]] || {
  echo "Team configuration not found: $TEAM_CONFIG" >&2
  echo "Copy deploy/team/team-config.example.json to deploy/team/team-config.local.json and fill in the internal endpoints." >&2
  exit 1
}
TEAM_CONFIG="$(cd "$(dirname "$TEAM_CONFIG")" && pwd)/$(basename "$TEAM_CONFIG")"
[[ -r "$CONNECTIONS_SOURCE" ]] || {
  echo "Connection catalog not found: $CONNECTIONS_SOURCE" >&2
  echo "Copy your connection.json to deploy/team/team-connections.local.json or pass --connections-file." >&2
  exit 1
}
CONNECTIONS_SOURCE="$(cd "$(dirname "$CONNECTIONS_SOURCE")" && pwd)/$(basename "$CONNECTIONS_SOURCE")"
SOURCE_COMMIT="$(git rev-parse HEAD)"
SOURCE_SHORT="$(git rev-parse --short=7 HEAD)"
SOURCE_BRANCH="$(git branch --show-current)"
NPM_PACKAGE_VERSION="$(node -p 'require("./package.json").version')"

if [[ -z "$DEPLOY_VERSION" ]]; then
  DEPLOY_VERSION="${NPM_PACKAGE_VERSION}"
fi
[[ "$DEPLOY_VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
  echo "Invalid deployment version: $DEPLOY_VERSION" >&2
  exit 2
}

if [[ -n "$(git status --porcelain --untracked-files=normal)" && "$ALLOW_DIRTY" != "1" ]]; then
  echo "Working tree is not clean; commit or stash changes before packaging." >&2
  echo "Use --allow-dirty only while developing the package script." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opengrok-team-deploy.XXXXXX")"
cleanup() {
  if [[ -n "${WORK_DIR:-}" && -d "$WORK_DIR" ]]; then
    rm -rf -- "$WORK_DIR"
  fi
}
trap cleanup EXIT

BUNDLE_NAME="opengork-mcp-v${DEPLOY_VERSION}"
BUNDLE_DIR="${WORK_DIR}/${BUNDLE_NAME}"
PACK_DIR="${WORK_DIR}/npm-pack"
mkdir -p "$BUNDLE_DIR" "$PACK_DIR" "$BUNDLE_DIR/vendor"
cp -a "$TEMPLATE_DIR/." "$BUNDLE_DIR/"

echo "==> Building npm package from ${SOURCE_COMMIT}"
npm pack --pack-destination "$PACK_DIR" >/dev/null
packed_count="$(find "$PACK_DIR" -maxdepth 1 -type f -name '*.tgz' -print | wc -l | tr -d '[:space:]')"
[[ "$packed_count" -eq 1 ]] || {
  echo "Expected exactly one npm tarball, found $packed_count" >&2
  exit 1
}
packed_archive="$(find "$PACK_DIR" -maxdepth 1 -type f -name '*.tgz' -print -quit)"
BUNDLED_TARBALL="${BUNDLE_DIR}/vendor/opengrok-mcp-server-${NPM_PACKAGE_VERSION}.tgz"
cp "$packed_archive" "$BUNDLED_TARBALL"

PACKAGE_SHA256="$(node -e 'const fs=require("fs"),c=require("crypto");const b=fs.readFileSync(process.argv[1]);process.stdout.write(c.createHash("sha256").update(b).digest("hex"))' "$BUNDLED_TARBALL")"
TEAM_CONFIG_SHA256="$(node -e 'const fs=require("fs"),c=require("crypto");const b=fs.readFileSync(process.argv[1]);process.stdout.write(c.createHash("sha256").update(b).digest("hex"))' "$TEAM_CONFIG")"
CONNECTIONS_SOURCE_SHA256="$(node -e 'const fs=require("fs"),c=require("crypto");const b=fs.readFileSync(process.argv[1]);process.stdout.write(c.createHash("sha256").update(b).digest("hex"))' "$CONNECTIONS_SOURCE")"

echo "==> Rendering deployment template ${DEPLOY_VERSION}"
DEPLOY_VERSION="$DEPLOY_VERSION" \
SOURCE_COMMIT="$SOURCE_COMMIT" \
SOURCE_SHORT="$SOURCE_SHORT" \
SOURCE_BRANCH="$SOURCE_BRANCH" \
NPM_PACKAGE_VERSION="$NPM_PACKAGE_VERSION" \
PACKAGE_SHA256="$PACKAGE_SHA256" \
TEAM_CONFIG_SHA256="$TEAM_CONFIG_SHA256" \
CONNECTIONS_SOURCE_SHA256="$CONNECTIONS_SOURCE_SHA256" \
TEAM_CONFIG="$TEAM_CONFIG" \
CONNECTIONS_SOURCE="$CONNECTIONS_SOURCE" \
BUNDLE_DIR="$BUNDLE_DIR" \
node <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = process.env.BUNDLE_DIR;
const teamConfig = JSON.parse(fs.readFileSync(process.env.TEAM_CONFIG, "utf8"));
const connectionDocument = JSON.parse(fs.readFileSync(process.env.CONNECTIONS_SOURCE, "utf8"));
const catalog = connectionDocument.connections;
if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
  throw new Error("Connection catalog must contain a connections object");
}
const entries = Object.entries(catalog);
const lxEntries = entries.filter(([name]) => name.startsWith("lx-"));
if (lxEntries.length < 2) throw new Error("Connection catalog must contain at least two lx- connections");
const allowedFields = new Set(["url", "cookieEnv", "proxyEnv", "direct", "verifySsl", "username", "defaultProject", "passwordEnv"]);
const network = teamConfig.network ?? (teamConfig.vwProxy ? { OPENGROK_PROXY_VW: teamConfig.vwProxy } : {});
if (!network || typeof network !== "object" || Array.isArray(network)) {
  throw new Error("Team configuration network must be an object");
}
for (const [key, raw] of Object.entries(network)) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key) || typeof raw !== "string") {
    throw new Error(`Invalid proxy configuration key ${JSON.stringify(key)}`);
  }
  const url = new URL(raw);
  if (!["http:", "https:", "socks5:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`Proxy ${key} must use HTTP(S) or SOCKS5 without embedded credentials`);
  }
}
const cookieEnvs = new Set();
for (const [name, connection] of entries) {
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !connection || typeof connection !== "object") {
    throw new Error(`Invalid connection ${JSON.stringify(name)}`);
  }
  const url = new URL(connection.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error(`Connection ${name} must have a credential-free HTTP(S) URL`);
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(connection.cookieEnv) || cookieEnvs.has(connection.cookieEnv)) {
    throw new Error(`Connection ${name} needs a unique cookieEnv`);
  }
  if (Object.keys(connection).some((key) => !allowedFields.has(key))) {
    throw new Error(`Connection ${name} contains unsupported fields`);
  }
  cookieEnvs.add(connection.cookieEnv);
  if (connection.proxyEnv !== undefined &&
      (typeof connection.proxyEnv !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(connection.proxyEnv))) {
    throw new Error(`Connection ${name} has an invalid proxyEnv`);
  }
  if (connection.direct !== undefined && typeof connection.direct !== "boolean") {
    throw new Error(`Connection ${name} has an invalid direct flag`);
  }
  if (connection.proxyEnv && connection.direct) throw new Error(`Connection ${name} has conflicting network settings`);
  if (connection.proxyEnv && !network[connection.proxyEnv]) {
    throw new Error(`Connection ${name} needs proxy ${connection.proxyEnv} in team configuration`);
  }
}
const replacements = new Map([
  ["__DEPLOY_VERSION__", process.env.DEPLOY_VERSION],
  ["__SOURCE_COMMIT__", process.env.SOURCE_COMMIT],
  ["__SOURCE_SHORT__", process.env.SOURCE_SHORT],
  ["__NPM_PACKAGE_VERSION__", process.env.NPM_PACKAGE_VERSION],
  ["__PACKAGE_SHA256__", process.env.PACKAGE_SHA256],
]);

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

for (const file of filesUnder(root)) {
  if (file.endsWith(".tgz")) continue;
  let text = fs.readFileSync(file, "utf8");
  for (const [placeholder, value] of replacements) {
    text = text.split(placeholder).join(value);
  }
  fs.writeFileSync(file, text);
}

const configDir = path.join(root, ".config", "opengrok-mcp");
fs.writeFileSync(path.join(configDir, "connections.catalog.json"), JSON.stringify({ connections: catalog }, null, 2) + "\n");
fs.writeFileSync(path.join(configDir, "connections.json"), JSON.stringify({ connections: Object.fromEntries(lxEntries) }, null, 2) + "\n");
fs.writeFileSync(path.join(configDir, "network.json"), JSON.stringify(network, null, 2) + "\n");

fs.writeFileSync(path.join(root, "VERSION"), `${process.env.DEPLOY_VERSION}\n`);
fs.writeFileSync(path.join(root, "SOURCE_COMMIT"), `${process.env.SOURCE_COMMIT}\n`);
fs.writeFileSync(path.join(root, "PACKAGE_MANIFEST.json"), `${JSON.stringify({
  deploymentVersion: process.env.DEPLOY_VERSION,
  createdAt: new Date().toISOString(),
  sourceRepository: "https://github.com/Colin-Cai0318/opengrok-mcp-server",
  sourceBranch: process.env.SOURCE_BRANCH,
  sourceCommit: process.env.SOURCE_COMMIT,
  npmPackageName: "@colin-cai0318/opengrok-mcp-server",
  npmPackageVersion: process.env.NPM_PACKAGE_VERSION,
  bundledTarball: `vendor/opengrok-mcp-server-${process.env.NPM_PACKAGE_VERSION}.tgz`,
  bundledTarballSha256: process.env.PACKAGE_SHA256,
  teamConfigurationSha256: process.env.TEAM_CONFIG_SHA256,
  connectionCatalogSha256: process.env.CONNECTIONS_SOURCE_SHA256,
}, null, 2)}\n`);

const unresolved = [...replacements.keys()].flatMap((placeholder) =>
  filesUnder(root)
    .filter((file) => !file.endsWith(".tgz"))
    .filter((file) => fs.readFileSync(file, "utf8").includes(placeholder))
    .map((file) => `${placeholder} in ${path.relative(root, file)}`)
);
if (unresolved.length) throw new Error(`Unresolved placeholders: ${unresolved.join(", ")}`);

const checksums = filesUnder(root)
  .filter((file) => path.basename(file) !== "SHA256SUMS")
  .sort()
  .map((file) => {
    const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    return `${digest}  ./${path.relative(root, file)}`;
  });
fs.writeFileSync(path.join(root, "SHA256SUMS"), `${checksums.join("\n")}\n`);
NODE

chmod 700 "$BUNDLE_DIR"/*.sh "$BUNDLE_DIR"/bin/*.sh "$BUNDLE_DIR"/bin/*.py

echo "==> Validating generated bundle"
while IFS= read -r -d '' shell_file; do bash -n "$shell_file"; done < <(find "$BUNDLE_DIR" -type f -name '*.sh' -print0)
while IFS= read -r -d '' json_file; do node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$json_file"; done < <(find "$BUNDLE_DIR" -type f -name '*.json' -print0)
PYTHONPYCACHEPREFIX="${WORK_DIR}/pycache" python3 -m py_compile "$BUNDLE_DIR/bin/opengrok_cookie_helper.py"
node --check "$BUNDLE_DIR/chrome-extension/background.js"
node --check "$BUNDLE_DIR/chrome-extension/popup.js"

if find "$BUNDLE_DIR" -type f \( -name 'helper.token' -o -name 'cookies.json' -o -name 'opengrok.env' -o -name '*.cookie' \) -print -quit | grep -q .; then
  echo "Refusing to package runtime credentials" >&2
  exit 1
fi

ZIP_TMP="${WORK_DIR}/${BUNDLE_NAME}.zip"
(
  cd "$WORK_DIR"
  zip -q -r -X "$ZIP_TMP" "$BUNDLE_NAME"
)
unzip -t "$ZIP_TMP" >/dev/null

FINAL_ZIP="${OUTPUT_DIR}/${BUNDLE_NAME}.zip"
install -m 644 "$ZIP_TMP" "$FINAL_ZIP"
ZIP_SHA256="$(node -e 'const fs=require("fs"),c=require("crypto");const b=fs.readFileSync(process.argv[1]);process.stdout.write(c.createHash("sha256").update(b).digest("hex"))' "$FINAL_ZIP")"
printf '%s  %s\n' "$ZIP_SHA256" "$(basename "$FINAL_ZIP")" > "${FINAL_ZIP}.sha256"

echo
echo "Team deployment package ready:"
echo "  ${FINAL_ZIP}"
echo "  ${FINAL_ZIP}.sha256"
echo "  SHA256: ${ZIP_SHA256}"
