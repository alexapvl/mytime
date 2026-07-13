#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${1:-$(uname -m)}"
OUT_DIR="${MYTIME_EVENTKIT_OUT_DIR:-$ROOT/dist/native}"
SOURCE="$ROOT/native/eventkit/main.swift"
INFO_PLIST="$ROOT/native/eventkit/Info.plist"
OUTPUT="$OUT_DIR/mytime-eventkit"
DEFAULT_DEVELOPER_ID="Developer ID Application: ALEXANDRU APĂVĂLOAIEI (THZ82CJTKM)"

case "$ARCH" in
  arm64|x86_64) ;;
  *)
    echo "unsupported architecture: $ARCH (use arm64 or x86_64)" >&2
    exit 1
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping EventKit helper: Apple Calendar integration is available on macOS 14+ only"
  exit 0
fi

if [[ "$(uname -m)" != "$ARCH" ]]; then
  echo "host architecture is $(uname -m), cannot build native $ARCH helper" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

xcrun swiftc \
  -O \
  -target "${ARCH}-apple-macosx14.0" \
  -framework EventKit \
  -Xlinker -sectcreate \
  -Xlinker __TEXT \
  -Xlinker __info_plist \
  -Xlinker "$INFO_PLIST" \
  "$SOURCE" \
  -o "$OUTPUT"

SIGNING_IDENTITY="${MYTIME_CODESIGN_IDENTITY:-}"
if [[ -z "$SIGNING_IDENTITY" ]] && security find-identity -v -p codesigning | grep -Fq "$DEFAULT_DEVELOPER_ID"; then
  SIGNING_IDENTITY="$DEFAULT_DEVELOPER_ID"
fi

if [[ -n "$SIGNING_IDENTITY" ]]; then
  codesign \
    --force \
    --options runtime \
    --timestamp \
    --sign "$SIGNING_IDENTITY" \
    --identifier dev.apvl.mytime.calendar-helper \
    "$OUTPUT"
  echo "Signed EventKit helper with $SIGNING_IDENTITY"
else
  if [[ "${MYTIME_REQUIRE_SIGNING:-0}" == "1" ]]; then
    echo "Developer ID signing identity is required for release builds" >&2
    exit 1
  fi
  codesign --force --sign - --identifier dev.apvl.mytime.calendar-helper "$OUTPUT"
  echo "Warning: ad-hoc EventKit signature; Calendar permission may reset after upgrades" >&2
fi

echo "Built $OUTPUT"
