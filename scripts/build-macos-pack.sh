#!/usr/bin/env bash
# Build a macOS mytime release pack.
# Usage: scripts/build-macos-pack.sh <version> <arm64|x86_64> [slim|standalone]
#   slim (default) — dist + node_modules for Homebrew (depends_on node@20)
#   standalone     — slim + vendored Node 20 for portable installs
set -euo pipefail

VERSION="${1:?usage: build-macos-pack.sh <version> <arm64|x86_64> [slim|standalone]}"
ARCH="${2:?usage: build-macos-pack.sh <version> <arm64|x86_64> [slim|standalone]}"
MODE="${3:-slim}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="${NODE_VERSION:-20.20.2}"

case "$ARCH" in
  arm64) NODE_ARCH=darwin-arm64 ;;
  x86_64) NODE_ARCH=darwin-x64 ;;
  *)
    echo "unsupported arch: $ARCH (use arm64 or x86_64)" >&2
    exit 1
    ;;
esac

case "$MODE" in
  slim|standalone) ;;
  *)
    echo "unsupported mode: $MODE (use slim or standalone)" >&2
    exit 1
    ;;
esac

OUT_DIR="$ROOT/release"
STAGE="$(mktemp -d)"
DEPLOY_DIR="$(mktemp -d)"
PACK_SUFFIX="macos-${ARCH}$([[ "$MODE" == standalone ]] && echo '-standalone' || echo '')"
PACK_NAME="mytime-${VERSION}-${PACK_SUFFIX}"
TARBALL="$OUT_DIR/${PACK_NAME}.tar.gz"

cleanup() { rm -rf "$STAGE" "$DEPLOY_DIR"; }
trap cleanup EXIT

prune_tree() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0

  find "$dir" -type f \( \
    -name '*.map' \
    -o -name '*.md' \
    -o -name '*.markdown' \
    -o -name 'CHANGELOG*' \
    -o -name 'LICENSE.md' \
    -o -name 'README*' \
    -o -name '*.ts' ! -name '*.d.ts' \
    -o -name '*.tsx' \
    -o -name '*.mts' \
    -o -name '*.cts' \
    \) -delete 2>/dev/null || true

  find "$dir" -type d \( \
    -name test \
    -o -name tests \
    -o -name __tests__ \
    -o -name docs \
    -o -name doc \
    -o -name examples \
    -o -name example \
    -o -name .github \
    \) -prune -exec rm -rf {} + 2>/dev/null || true

  find "$dir" -type d -name '@types' -prune -exec rm -rf {} + 2>/dev/null || true
  find "$dir" -type d -empty -delete 2>/dev/null || true
}

strip_node_runtime() {
  local node_dir="$1"
  rm -rf \
    "$node_dir/include" \
    "$node_dir/share" \
    "$node_dir/CHANGELOG.md" \
    "$node_dir/README.md" \
    "$node_dir/LICENSE"
}

write_runtime_package_json() {
  node -e "
const fs = require('fs');
const bundled = new Set(['@toon-format/toon', 'chrono-node', 'luxon', 'string-width', 'uuid', 'zod']);
const pkg = JSON.parse(fs.readFileSync('${ROOT}/package.json', 'utf8'));
for (const name of bundled) delete pkg.dependencies[name];
delete pkg.devDependencies;
fs.writeFileSync('${DEPLOY_DIR}/package.json', JSON.stringify(pkg, null, 2) + '\n');
"
  echo 'node-linker=hoisted' > "$DEPLOY_DIR/.npmrc"
}

smoke_test() {
  local node_bin="$1"
  "$node_bin" --no-deprecation "$STAGE/libexec/dist/cli.js" help >/dev/null
}

echo "==> build mytime $VERSION ($MODE) for macos-$ARCH"

cd "$ROOT"
pnpm install --frozen-lockfile
pnpm build
mkdir -p "$OUT_DIR"
rm -f "$TARBALL"

echo "==> install production dependencies"
write_runtime_package_json
(
  cd "$DEPLOY_DIR"
  pnpm install --no-frozen-lockfile --prod
  prune_tree node_modules
)

mkdir -p "$STAGE/libexec"
cp -R "$ROOT/dist" "$STAGE/libexec/dist"
cp -R "$DEPLOY_DIR/node_modules" "$STAGE/libexec/node_modules"
rm -rf "$STAGE/libexec/dist/release" 2>/dev/null || true
prune_tree "$STAGE/libexec/dist"

if [[ "$MODE" == standalone ]]; then
  echo "==> fetch Node.js v${NODE_VERSION} (${NODE_ARCH})"
  NODE_TAR="node-v${NODE_VERSION}-${NODE_ARCH}.tar.gz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR}" -o "$STAGE/${NODE_TAR}"
  tar -xzf "$STAGE/${NODE_TAR}" -C "$STAGE/libexec"
  mv "$STAGE/libexec/node-v${NODE_VERSION}-${NODE_ARCH}" "$STAGE/libexec/node"
  rm "$STAGE/${NODE_TAR}"
  strip_node_runtime "$STAGE/libexec/node"
  prune_tree "$STAGE/libexec/node"

  mkdir -p "$STAGE/bin"
  cat > "$STAGE/bin/mytime" << 'EOF'
#!/usr/bin/env bash
SOURCE="$0"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
ROOT="$(cd "$(dirname "$SOURCE")/.." && pwd)"
exec "${ROOT}/libexec/node/bin/node" --no-deprecation "${ROOT}/libexec/dist/cli.js" "$@"
EOF
  chmod +x "$STAGE/bin/mytime"
  smoke_test "$STAGE/libexec/node/bin/node"
else
  smoke_test "$(command -v node)"
fi

mkdir -p "$OUT_DIR"
if [[ "$MODE" == standalone ]]; then
  tar -czf "$TARBALL" -C "$STAGE" bin libexec
else
  tar -czf "$TARBALL" -C "$STAGE" libexec
fi

SHA="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
SIZE="$(du -h "$TARBALL" | awk '{print $1}')"
UNPACKED="$(du -sh "$STAGE" | awk '{print $1}')"

echo ""
echo "Created: $TARBALL ($SIZE compressed, ${UNPACKED} unpacked)"
echo "sha256: $SHA"
echo ""
echo "Homebrew formula snippet (macos-${ARCH}, ${MODE}):"
echo "  url \"https://github.com/alexapvl/mytime/releases/download/v${VERSION}/${PACK_NAME}.tar.gz\""
echo "  sha256 \"${SHA}\""
echo "Smoke test: ok"
