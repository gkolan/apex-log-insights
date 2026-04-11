#!/usr/bin/env bash
set -euo pipefail

# Build the Edge extension from shared assets + Edge manifest
#
# Usage:
#   bash scripts/build-edge.sh                 # rebuild with current version
#   bash scripts/build-edge.sh --version 1.2.0 # bump to 1.2.0, sync, then build
#
# Output: dist/edge/                    (unpacked extension directory)
#         dist/edge-extension-vX.Y.Z.zip (ready for Edge Add-ons upload)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
DIST_DIR="$PKG_DIR/dist"
OUT_DIR="$DIST_DIR/edge"

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
      echo "Usage: build-edge.sh [--version X.Y.Z]"
      exit 1
      ;;
  esac
done

if [[ -n "$NEW_VERSION" ]]; then
  if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Version must be in semver format (e.g. 1.2.0), got: $NEW_VERSION"
    exit 1
  fi

  echo "Bumping version to ${NEW_VERSION}..."

  node -e "
    const fs = require('fs');
    const path = '$REPO_ROOT/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = '$NEW_VERSION';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "

  node "$REPO_ROOT/scripts/sync-versions.mjs"
  echo ""
fi

# ─── Build ────────────────────────────────────────────────────────────────────

VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PKG_DIR/manifests/edge/manifest.json','utf8')).version)")

echo "Building Edge extension v${VERSION}..."

cd "$PKG_DIR"
pnpm build

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

cp -r "$PKG_DIR/shared/"* "$OUT_DIR/"
cp "$PKG_DIR/manifests/edge/manifest.json" "$OUT_DIR/manifest.json"
cp "$DIST_DIR/content/apex-parser-worker.js" "$OUT_DIR/content/" 2>/dev/null || true

ZIP_NAME="edge-extension-v${VERSION}.zip"
cd "$DIST_DIR"
rm -f edge-extension-v*.zip
cd edge && zip -r "../${ZIP_NAME}" . -x '*.DS_Store' && cd ..

echo ""
echo "Edge extension v${VERSION} built:"
echo "  Unpacked: $OUT_DIR/"
echo "  Zip:      $DIST_DIR/${ZIP_NAME}"
