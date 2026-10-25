#!/usr/bin/env bash
# build.sh [--download-node] <darwin-arm64|linux-x64|win32-x64>: compile the source fetch.sh made (build/vscode-src) with
# VS Code's own gulp build, the way VSCodium's build.sh does it (npm ci, `vscode-min-prepack`, the policy files,
# `vscode-<platform>-min-packing`: together the gulp task `vscode-<platform>-min`). The app ends up in build/vscode-out/<platform>/
# (darwin-arm64: VSCodium.app, like the folder inside VSCodium's zip, so build-mac.sh goes on unchanged; linux-x64: the app
# folder with `codium`, `bin/` and `resources/app`, like the one inside VSCodium's .deb, for make-deb.sh; win32-x64: the app
# folder with VSCodium.exe, `bin/` and `resources/app`, like the one inside VSCodium's zip, for build-win.sh).
# Needs the Node version of VS Code's .nvmrc: --download-node fetches exactly that into build/ (checked against nodejs.org's
# SHASUMS256.txt). On Ubuntu it also needs build-essential, pkg-config, git, python3, libx11-dev, libxkbfile-dev,
# libsecret-1-dev and libkrb5-dev (VS Code's native modules); build on the oldest Ubuntu the .deb should run on (22.04),
# the native modules need the glibc they were built with.
# win32-x64 only builds on Windows, under Git Bash (Git for Windows), with Visual Studio 2022's C++ tools (MSVC, the Windows SDK) and Python
# (VS Code's native modules; preinstall.ts checks the compiler): a cross build from a Mac or Linux is refused. Node comes as the
# zip from nodejs.org with --download-node. Output: VSCodium.exe (the name VSCodium's product.json gives), no Rust CLI.
# Takes about half an hour the first time, 20 GB of disk at most. Not built: VSCodium's Rust CLI (the remote-tunnel program):
# Kural doesn't use it.
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/vscode/lock.sh
# python3 on Windows is python (actions/setup-python has no python3; the Microsoft Store's python3 is a stub that fails)
python3 -c '' >/dev/null 2>&1 || python3() { python "$@"; }

DOWNLOAD_NODE=0 PLATFORM=""
for a in "$@"; do
  case "$a" in
    --download-node) DOWNLOAD_NODE=1 ;;
    -h|--help) sed -n 2,16p "$0"; exit 0 ;;
    -*) echo "Unknown option: $a (try --help)" >&2; exit 1 ;;
    *) PLATFORM="$a" ;;
  esac
done
case "$PLATFORM" in
  darwin-arm64|linux-x64|win32-x64) ;;
  *) echo "usage: scripts/vscode/build.sh [--download-node] <darwin-arm64|linux-x64|win32-x64>" >&2; exit 1 ;;
esac
if [ "$PLATFORM" = win32-x64 ]; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *) echo "Error: win32-x64 can only be built on Windows (VS Code's native modules need MSVC and the Windows SDK), in Git Bash;
  this computer is $(uname -s). Build it with the 'windows' job of .github/workflows/build-from-source.yml." >&2; exit 1 ;;
  esac
fi
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
case "$PLATFORM" in darwin-arm64) NODE_PLAT=darwin-arm64 ;; linux-x64) NODE_PLAT=linux-x64 ;; win32-x64) NODE_PLAT=win-x64 ;; esac
LOCAL_NODE="$KURAL_ROOT/build/node-v$NEED-$NODE_PLAT"
# nodejs.org's Windows zip has node.exe, npm and npm.cmd in its top folder; the Mac and Linux tarballs have them in bin/
if [ "$PLATFORM" = win32-x64 ]; then NODE_DIR="$LOCAL_NODE" NODE_EXE=node.exe; else NODE_DIR="$LOCAL_NODE/bin" NODE_EXE=node; fi
if [ -x "$NODE_DIR/$NODE_EXE" ] && node_ok "$NODE_DIR/$NODE_EXE"; then
  export PATH="$NODE_DIR:$PATH"
elif ! command -v node >/dev/null 2>&1 || ! node_ok node; then
  if [ "$DOWNLOAD_NODE" = 1 ] && [ -n "$NODE_PLAT" ]; then
    echo "Downloading Node v$NEED ($NODE_PLAT) into $LOCAL_NODE ..."
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    base="https://nodejs.org/dist/v$NEED"
    if [ "$PLATFORM" = win32-x64 ]; then file="node-v$NEED-$NODE_PLAT.zip"; else file="node-v$NEED-$NODE_PLAT.tar.gz"; fi
    curl -fL -o "$tmp/$file" "$base/$file"
    curl -fL -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
    want="$(grep -F "  $file" "$tmp/SHASUMS256.txt" | awk '{print $1}')"; [ -n "$want" ] || die "no checksum for $file at nodejs.org"
    got="$(hash < "$tmp/$file")"; [ "$got" = "$want" ] || die "$file: checksum does not match nodejs.org's"
    mkdir -p "$LOCAL_NODE"
    if [ "$PLATFORM" = win32-x64 ]; then
      # (Git Bash has no unzip, and its tar doesn't read zips: Python's zipfile does, without the archive's top folder)
      python3 -I - "$tmp/$file" "$LOCAL_NODE" <<'PYEOF'
import os, sys, zipfile
archive, dest = sys.argv[1], os.path.abspath(sys.argv[2])
with zipfile.ZipFile(archive) as z:
    for info in z.infolist():
        rel = info.filename.split("/", 1)[1] if "/" in info.filename else ""
        if not rel: continue
        target = os.path.abspath(os.path.join(dest, rel))
        if target != dest and not target.startswith(dest + os.sep): sys.exit(f"{info.filename}: outside the target folder")
        if info.is_dir(): os.makedirs(target, exist_ok=True); continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with z.open(info) as src, open(target, "wb") as out: out.write(src.read())
PYEOF
    else
      tar -xzf "$tmp/$file" -C "$LOCAL_NODE" --strip-components=1
    fi
    export PATH="$NODE_DIR:$PATH"
  else
    have="$(command -v node >/dev/null 2>&1 && node -p 'process.versions.node' || echo 'no node')"
    die "VS Code needs Node v$NEED (same major, $NEED or newer); this computer has: $have.
  Install it (nvm install $NEED, fnm install $NEED, or nodejs.org), or run this again with --download-node (a private copy in build/)."
  fi
fi
# On Windows npm is npm.cmd (nodejs.org's folder has an `npm` shell script too; the .cmd is the one VS Code's own scripts use)
if [ "$PLATFORM" = win32-x64 ] && command -v npm.cmd >/dev/null 2>&1; then npm() { npm.cmd "$@"; }; fi
echo "Node $(node -v), npm $(npm -v), building $PLATFORM from VS Code $(lock_get vscode_version) ($(lock_get vscode_commit | cut -c1-10))"

# --- the environment VSCodium builds in
export ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export NODE_OPTIONS="--max-old-space-size=8192" VSCODE_QUALITY=stable VSCODE_PUBLISH_COUNTER=1
# (VS Code's own Windows pipeline sets npm_config_arch for npm ci; Python's text files are UTF-8 for every script of ours)
if [ "$PLATFORM" = win32-x64 ]; then export npm_config_arch=x64 PYTHONUTF8=1; fi
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
  [ -x "$RG" ] || RG=node_modules/@vscode/ripgrep/bin/rg.exe
  if sed --version >/dev/null 2>&1; then SEDI=(sed -i -E); else SEDI=(sed -i '' -E); fi
  { if [ -x "$RG" ]; then "$RG" --no-ignore --path-separator / -l '\.data\.microsoft\.com' . || true
    else grep -rlE --exclude-dir=.git '\.data\.microsoft\.com' . || true; fi; } \
    | while IFS= read -r f; do "${SEDI[@]}" 's|//[^/]+\.data\.microsoft\.com|//0.0.0.0|g' "$f"; done
  echo "$want" > "$NPM_STAMP"
fi

# --- compile and package
case "$PLATFORM" in darwin-arm64) POLICY=darwin ;; linux-x64) POLICY=linux ;; *) POLICY=win32 ;; esac
npm run gulp vscode-min-prepack
if [ "$PLATFORM" != win32-x64 ]; then   # (a Windows file; VSCodium removes it on Mac and Linux)
  rm -f .build/extensions/ms-vscode.js-debug/src/win32-app-container-tokens.*.node
fi
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
if [ "$PLATFORM" = win32-x64 ]; then
  [ -f "$BUILT/VSCodium.exe" ] && [ -f "$BUILT/resources/app/package.json" ] || die "$BUILT has no VSCodium.exe and resources/app"
fi
rm -rf "$OUT" && mkdir -p "$(dirname "$OUT")" && mv "$BUILT" "$OUT"
echo "$want_build" > "$BUILD_STAMP"
echo "Built $PLATFORM in $(( ($(date +%s) - START) / 60 )) min: $OUT ($(du -sh "$OUT" | awk '{print $1}'))"
