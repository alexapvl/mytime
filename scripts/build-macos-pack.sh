#!/usr/bin/env bash
# Build a self-contained macOS mytime pack (vendored Node + prod deps + dist).
# Usage: scripts/build-macos-pack.sh <version> <arm64|x86_64>
set -euo pipefail

VERSION="${1:?usage: build-macos-pack.sh <version> <arm64|x86_64>}"
ARCH="${2:?usage: build-macos-pack.sh <version> <arm64|x86_64>}"
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

OUT_DIR="$ROOT/dist/release"
STAGE="$(mktemp -d)"
PACK_NAME="mytime-${VERSION}-macos-${ARCH}"
TARBALL="$OUT_DIR/${PACK_NAME}.tar.gz"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "==> build mytime $VERSION for macos-$ARCH"

cd "$ROOT"
pnpm install --frozen-lockfile
pnpm build

mkdir -p "$STAGE/libexec" "$STAGE/bin"
cp "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$STAGE/libexec/"
cp -R "$ROOT/dist" "$STAGE/libexec/dist"

echo "==> install production dependencies"
(
  cd "$STAGE/libexec"
  pnpm install --frozen-lockfile --prod
)

echo "==> fetch Node.js v${NODE_VERSION} (${NODE_ARCH})"
NODE_TAR="node-v${NODE_VERSION}-${NODE_ARCH}.tar.gz"
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR}" -o "$STAGE/${NODE_TAR}"
tar -xzf "$STAGE/${NODE_TAR}" -C "$STAGE/libexec"
mv "$STAGE/libexec/node-v${NODE_VERSION}-${NODE_ARCH}" "$STAGE/libexec/node"
rm "$STAGE/${NODE_TAR}"

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

mkdir -p "$OUT_DIR"
tar -czf "$TARBALL" -C "$STAGE" bin libexec

SHA="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
SIZE="$(du -h "$TARBALL" | awk '{print $1}')"

echo ""
echo "Created: $TARBALL ($SIZE)"
echo "sha256: $SHA"
echo ""
echo "Homebrew formula snippet (macos-${ARCH}):"
echo "  url \"https://github.com/alexapvl/mytime/releases/download/v${VERSION}/${PACK_NAME}.tar.gz\""
echo "  sha256 \"${SHA}\""

# Smoke test
"$STAGE/bin/mytime" help >/dev/null
echo "Smoke test: ok"
