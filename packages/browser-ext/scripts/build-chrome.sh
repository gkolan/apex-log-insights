#!/usr/bin/env bash
set -euo pipefail

# Build the Chrome extension from shared assets + Chrome manifest
#
# Usage:
#   bash scripts/build-chrome.sh                 # rebuild with current version
#   bash scripts/build-chrome.sh --version 1.2.0 # bump to 1.2.0, sync, then build
#
# Output: dist/chrome/                    (unpacked extension directory)
#         dist/chrome-extension-vX.Y.Z.zip (ready for Chrome Web Store upload)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
DIST_DIR="$PKG_DIR/dist"
OUT_DIR="$DIST_DIR/chrome"

# ─── Optional version bump ────────────────────────────────────────────────────

NEW_VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|-v)
      NEW_VERSION="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: build-chrome.sh [--version X.Y.Z]"
      exit 1
      ;;
  esac
done

if [[ -n "$NEW_VERSION" ]]; then
  # Validate semver format
  if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Version must be in semver format (e.g. 1.2.0), got: $NEW_VERSION"
    exit 1
  fi

  echo "Bumping version to ${NEW_VERSION}..."

  # Update root package.json
  node -e "
    const fs = require('fs');
    const path = '$REPO_ROOT/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = '$NEW_VERSION';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "

  # Sync to all packages and manifests
  node "$REPO_ROOT/scripts/sync-versions.mjs"
  echo ""
fi

# ─── Build ────────────────────────────────────────────────────────────────────

# Read version from the Chrome manifest
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG_DIR/manifests/chrome/manifest.json','utf8')).version)")

echo "Building Chrome extension v${VERSION}..."

# 1. Build extension shared assets from source (worker + assembled UI)
cd "$PKG_DIR"
pnpm build

# 2. Assemble: shared assets + Chrome manifest + built worker
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Copy all shared static files
cp -r "$PKG_DIR/shared/"* "$OUT_DIR/"

# Overwrite manifest with Chrome-specific version
cp "$PKG_DIR/manifests/chrome/manifest.json" "$OUT_DIR/manifest.json"
cp "$REPO_ROOT/THIRD-PARTY-NOTICES.md" "$OUT_DIR/THIRD-PARTY-NOTICES.md"

# Ensure latest built worker is in the output
cp "$DIST_DIR/content/apex-parser-worker.js" "$OUT_DIR/content/" 2>/dev/null || true

# 3. Zip for Chrome Web Store
ZIP_NAME="chrome-extension-v${VERSION}.zip"
cd "$DIST_DIR"
rm -f chrome-extension-v*.zip
cd chrome && zip -r "../${ZIP_NAME}" . -x '*.DS_Store' && cd ..

echo ""
echo "Chrome extension v${VERSION} built:"
echo "  Unpacked: $OUT_DIR/"
echo "  Zip:      $DIST_DIR/${ZIP_NAME}"
