#!/usr/bin/env bash
# build.sh [--download-node] <darwin-arm64|linux-x64|win32-x64>: compile the source fetch.sh made (build/vscode-src) with
# VS Code's own gulp build, the way VSCodium's build.sh does it (npm ci, `vscode-min-prepack`, the policy files,
# `vscode-<platform>-min-packing`: together the gulp task `vscode-<platform>-min`). The app ends up in build/vscode-out/<platform>/
# (darwin-arm64: VSCodium.app, like the folder inside VSCodium's zip, so build-mac.sh goes on unchanged; linux-x64: the app
# folder with `codium`, `bin/` and `resources/app`, like the one inside VSCodium's .deb, for make-deb.sh).
# Needs the Node version of VS Code's .nvmrc: --download-node fetches exactly that into build/ (checked against nodejs.org's
# SHASUMS256.txt). On Ubuntu it also needs build-essential, pkg-config, git, python3, libx11-dev, libxkbfile-dev,
# libsecret-1-dev and libkrb5-dev (VS Code's native modules); build on the oldest Ubuntu the .deb should run on (22.04),
# the native modules need the glibc they were built with.
# Takes about half an hour the first time, 20 GB of disk at most. Not built: VSCodium's Rust CLI (the remote-tunnel program):
# Kural doesn't use it.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/vscode/lock.sh

DOWNLOAD_NODE=0 PLATFORM=""
for a in "$@"; do
  case "$a" in
    --download-node) DOWNLOAD_NODE=1 ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    -*) echo "Unknown option: $a (try --help)" >&2; exit 1 ;;
    *) PLATFORM="$a" ;;
  esac
done
case "$PLATFORM" in
  darwin-arm64|linux-x64|win32-x64) ;;
  *) echo "usage: scripts/vscode/build.sh [--download-node] <darwin-arm64|linux-x64|win32-x64>" >&2; exit 1 ;;
esac
SRC="$(cd "${VSCODE_SRC:-build/vscode-src}" 2>/dev/null && pwd)" || { echo "No source in build/vscode-src: run scripts/vscode/fetch.sh first." >&2; exit 1; }
[ -f "$SRC/.kural-source-stamp" ] || { echo "$SRC is not finished (no stamp): run scripts/vscode/fetch.sh again." >&2; exit 1; }
TAG="$(lock_get vscodium_tag)"
OUT="$KURAL_ROOT/build/vscode-out/$PLATFORM"
die() { echo "Error: $*" >&2; exit 1; }
START=$(date +%s)
# sha256 of stdin: sha256sum on Linux, shasum on a Mac (an Ubuntu without Perl's shasum works too)
hash() { if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'; else shasum -a 256 | awk '{print $1}'; fi; }

# Same source and same script as the app in build/vscode-out/<platform> was made from: nothing to compile again.
BUILD_STAMP="$KURAL_ROOT/build/vscode-out/$PLATFORM.stamp"
want_build="$( { cat "$SRC/.kural-source-stamp" "$0"; echo "$PLATFORM"; } | hash)"
if [ -d "$OUT" ] && [ "$(cat "$BUILD_STAMP" 2>/dev/null || true)" = "$want_build" ]; then
  echo "$OUT is up to date (same source and build.sh): not building again."; exit 0
fi
rm -f "$BUILD_STAMP"

# --- Node: exactly what .nvmrc asks for (same major, at least that minor.patch: preinstall.ts checks it too)
NEED="$(tr -d ' \r\n' < "$SRC/.nvmrc")"
node_ok() {   # node_ok <node program>
  local have; have="$("$1" -p 'process.versions.node' 2>/dev/null)" || return 1
  [ "$(printf '%s\n%s\n' "$NEED" "$have" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$NEED" ] && [ "${have%%.*}" = "${NEED%%.*}" ]
}
case "$PLATFORM" in darwin-arm64) NODE_PLAT=darwin-arm64 ;; linux-x64) NODE_PLAT=linux-x64 ;; *) NODE_PLAT="" ;; esac
LOCAL_NODE="$KURAL_ROOT/build/node-v$NEED-$NODE_PLAT"
if [ -x "$LOCAL_NODE/bin/node" ] && node_ok "$LOCAL_NODE/bin/node"; then
  export PATH="$LOCAL_NODE/bin:$PATH"
elif ! command -v node >/dev/null 2>&1 || ! node_ok node; then
  if [ "$DOWNLOAD_NODE" = 1 ] && [ -n "$NODE_PLAT" ]; then
    echo "Downloading Node v$NEED ($NODE_PLAT) into $LOCAL_NODE ..."
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    base="https://nodejs.org/dist/v$NEED"; file="node-v$NEED-$NODE_PLAT.tar.gz"
    curl -fL -o "$tmp/$file" "$base/$file"
    curl -fL -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
    want="$(grep -F "  $file" "$tmp/SHASUMS256.txt" | awk '{print $1}')"; [ -n "$want" ] || die "no checksum for $file at nodejs.org"
    got="$(hash < "$tmp/$file")"; [ "$got" = "$want" ] || die "$file: checksum does not match nodejs.org's"
    mkdir -p "$LOCAL_NODE" && tar -xzf "$tmp/$file" -C "$LOCAL_NODE" --strip-components=1
    export PATH="$LOCAL_NODE/bin:$PATH"
  else
    have="$(command -v node >/dev/null 2>&1 && node -p 'process.versions.node' || echo 'no node')"
    die "VS Code needs Node v$NEED (same major, $NEED or newer); this computer has: $have.
  Install it (nvm install $NEED, fnm install $NEED, or nodejs.org), or run this again with --download-node (a private copy in build/)."
  fi
fi
echo "Node $(node -v), npm $(npm -v), building $PLATFORM from VS Code $(lock_get vscode_version) ($(lock_get vscode_commit | cut -c1-10))"

# --- the environment VSCodium builds in
export ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export NODE_OPTIONS="--max-old-space-size=8192" VSCODE_QUALITY=stable VSCODE_PUBLISH_COUNTER=1
# The product.json "commit": VSCodium uses sha1 of its version, so an app built here reports what VSCodium's reports.
if command -v sha1sum >/dev/null 2>&1; then export BUILD_SOURCEVERSION="$(echo "${TAG/-*/}" | sha1sum | cut -d' ' -f1)"
else export BUILD_SOURCEVERSION="$(echo "${TAG/-*/}" | shasum -a 1 | cut -d' ' -f1)"; fi
cd "$SRC"

# --- npm ci (skipped when source, Node and platform are what the last one was done for)
NPM_STAMP="node_modules/.kural-npm-stamp"
want="$( { cat .kural-source-stamp; node -v; echo "$PLATFORM"; } | hash)"
if [ -d node_modules ] && [ "$(cat "$NPM_STAMP" 2>/dev/null || true)" = "$want" ]; then
  echo "npm ci: done before for this source, skipping."
else
  node build/npm/preinstall.ts
  for i in 1 2 3 4 5; do
    if [ "$PLATFORM" = darwin-arm64 ]; then CXX=clang++ npm ci && break; else npm ci && break; fi
    [ "$i" != 5 ] || die "npm ci failed 5 times"
    echo "npm ci failed ($i), trying again ..."; sleep $(( 15 * (i + 1) ))
  done
  # Telemetry addresses in the dependencies too (VSCodium's undo_telemetry.sh, after npm ci): *.data.microsoft.com -> 0.0.0.0
  echo "Telemetry off in the installed dependencies ..."
  RG=node_modules/@vscode/ripgrep/bin/rg
  if sed --version >/dev/null 2>&1; then SEDI=(sed -i -E); else SEDI=(sed -i '' -E); fi
  { if [ -x "$RG" ]; then "$RG" --no-ignore -l '\.data\.microsoft\.com' . || true
    else grep -rlE --exclude-dir=.git '\.data\.microsoft\.com' . || true; fi; } \
    | while IFS= read -r f; do "${SEDI[@]}" 's|//[^/]+\.data\.microsoft\.com|//0.0.0.0|g' "$f"; done
  echo "$want" > "$NPM_STAMP"
fi

# --- compile and package
case "$PLATFORM" in darwin-arm64) POLICY=darwin ;; linux-x64) POLICY=linux ;; *) POLICY=win32 ;; esac
npm run gulp vscode-min-prepack
rm -f .build/extensions/ms-vscode.js-debug/src/win32-app-container-tokens.*.node   # (a Windows file; VSCodium removes it on Mac and Linux)
npm run copy-policy-dto --prefix build
node build/lib/policies/policyGenerator.ts build/lib/policies/policyData.jsonc "$POLICY"
npm run gulp "vscode-$PLATFORM-min-packing"

# gulp writes to VSCode-<platform> beside the source folder
BUILT="$(dirname "$SRC")/VSCode-$PLATFORM"
[ -d "$BUILT" ] || die "the build finished but $BUILT is not there"
if [ "$PLATFORM" = darwin-arm64 ]; then
  [ -f "$BUILT/VSCodium.app/Contents/Resources/app/package.json" ] || die "$BUILT has no VSCodium.app/Contents/Resources/app"
fi
if [ "$PLATFORM" = linux-x64 ]; then
  [ -x "$BUILT/codium" ] && [ -f "$BUILT/resources/app/package.json" ] || die "$BUILT has no codium program and resources/app"
fi
rm -rf "$OUT" && mkdir -p "$(dirname "$OUT")" && mv "$BUILT" "$OUT"
echo "$want_build" > "$BUILD_STAMP"
echo "Built $PLATFORM in $(( ($(date +%s) - START) / 60 )) min: $OUT ($(du -sh "$OUT" | awk '{print $1}'))"
