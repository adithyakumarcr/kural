#!/usr/bin/env bash
# run.sh [--platform linux/amd64|linux/arm64] <mode>: try Kural on Linux from a Mac (or any Docker host), in a container.
#
# Modes:
#   test         npm test inside Linux. The repository is mounted READ-ONLY and copied to a scratch folder in the container,
#                so nothing is written to your checkout.
#   build        KURAL_SOURCE=1 ./make-deb.sh: VS Code from source + Kural's patches -> a .deb. The copy of the repository,
#                the source, node_modules and the .deb live in the Docker volume kural-linux-work-<arch>, not in the repo.
#                30-60 minutes natively; minutes to hours under emulation. Docker needs 8 GB of memory or more and about 40 GB of disk.
#   live         installs that .deb in a fresh container and, under Xvfb + openbox (a small desktop), checks that the app
#                opens a window and Kural's extension loads, then runs test/one-frame.live.js (never two windows shown, never
#                none, same bounds, closing the shown one shows the last hidden one).
#   shell        a shell in the container (repo at /repo, read-only; the volume at /work).
#   build-image  (re)builds the Docker image from scripts/linux-container/Dockerfile (the other modes do it when it is missing).
#   clean        removes this architecture's volume (the build, node_modules, the .deb): asks first, -y does not.
#
# Platform: by default the container's own architecture (linux/arm64 on an Apple Silicon Mac). VS Code supports
# linux-arm64, but make-deb.sh and scripts/vscode/build.sh only know x64 today ("the source build on Linux is for x64"), so
# `build` (and so `live`, which installs what `build` made) needs --platform linux/amd64, which Docker runs by emulation
# (Rosetta or QEMU): SLOW (about 5 minutes under Rosetta with 8 GB for Docker; QEMU is far slower), and a program under
# emulation can fail once: if the build stops in esbuild with "write EPIPE", run it again (npm ci and the source are kept).
# `test` runs on either (arm64: listen-host.test.js fails, Listen's voice isn't shipped for linux-arm64).
#
# Safety: docker run --rm, no --privileged, no host network; only the repository (read-only) and the named volumes
# are mounted. Electron runs with --no-sandbox in the container (no user namespaces without extra rights).
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd -P)"

PLATFORM="" MODE="" YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) [ $# -ge 2 ] || { echo "--platform needs linux/amd64 or linux/arm64" >&2; exit 1; }; PLATFORM="$2"; shift 2 ;;
    --platform=*) PLATFORM="${1#--platform=}"; shift ;;
    -y|--yes) YES=1; shift ;;
    -h|--help|help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $1 (try --help)" >&2; exit 1 ;;
    *) [ -z "$MODE" ] || { echo "One mode only (got '$MODE' and '$1')" >&2; exit 1; }; MODE="$1"; shift ;;
  esac
done
case "$MODE" in
  test|build|live|shell|build-image|clean) ;;
  "") echo "usage: scripts/linux-container/run.sh [--platform linux/amd64] <test|build|live|shell|build-image|clean>   (--help for more)" >&2; exit 1 ;;
  *) echo "Unknown mode: $MODE (try --help)" >&2; exit 1 ;;
esac
case "$PLATFORM" in ""|linux/amd64|linux/arm64) ;; *) echo "--platform: linux/amd64 or linux/arm64 (got $PLATFORM)" >&2; exit 1 ;; esac

# --- docker (the Mac's Docker Desktop keeps it outside PATH sometimes)
DOCKER="${DOCKER:-}"
if [ -z "$DOCKER" ]; then
  for c in "$(command -v docker 2>/dev/null || true)" "$HOME/.docker/bin/docker" /Applications/Docker.app/Contents/Resources/bin/docker /usr/local/bin/docker; do
    [ -n "$c" ] && [ -x "$c" ] && { DOCKER="$c"; break; }
  done
fi
[ -n "$DOCKER" ] || { echo "Docker is not installed (no docker program found). Install Docker Desktop or set DOCKER=/path/to/docker." >&2; exit 1; }
if ! "$DOCKER" info >/dev/null 2>&1; then
  if [ "$(uname -s)" = Darwin ] && [ -d /Applications/Docker.app ]; then
    echo "The Docker daemon is not running: starting Docker Desktop ..."
    open -a Docker || true
    for _ in $(seq 1 60); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 3; done
  fi
  "$DOCKER" info >/dev/null 2>&1 || { echo "The Docker daemon is not running. Start Docker, then run this again." >&2; exit 1; }
fi

ARCH="${PLATFORM#linux/}"
[ -n "$ARCH" ] || ARCH="$("$DOCKER" version --format '{{.Server.Arch}}')"
case "$ARCH" in x86_64) ARCH=amd64 ;; aarch64) ARCH=arm64 ;; esac
IMAGE="kural-linux:$ARCH"
VOLUME="kural-linux-work-$ARCH"
PLAT_ARGS=(); [ -z "$PLATFORM" ] || PLAT_ARGS=(--platform "$PLATFORM")
if [ "$ARCH" != amd64 ]; then
  [ "$MODE" != build ] || {
    cat >&2 <<MSG
build: this container is linux/$ARCH, and Kural's Linux source build is x64 only today:
  make-deb.sh stops with "the source build on Linux is for x64" on anything but x86_64, and scripts/vscode/build.sh only
  accepts darwin-arm64, linux-x64 and win32-x64. (VS Code itself builds linux-arm64; Kural's scripts would need an arm64
  platform in build.sh, make-deb.sh's package architecture and Depends, electron_runtime.py and sbom.py.)
Use the real x64 build under emulation instead (slow):
  scripts/linux-container/run.sh --platform linux/amd64 build
MSG
    exit 2; }
  [ "$MODE" != live ] || echo "note: live installs the x64 .deb that build makes; on linux/$ARCH there is none unless it was built with --platform linux/amd64." >&2
fi
[ "$ARCH" != amd64 ] || [ "$(uname -m)" = x86_64 ] || echo "warning: linux/amd64 on this computer runs by emulation: expect it to be slow (build: hours)." >&2

# NODE_VERSION: VS Code's .nvmrc for vscode.lock's commit (the Dockerfile's default); NODE_VERSION=... overrides.
image() {
  if [ "${1:-}" = force ] || ! "$DOCKER" image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Building the image $IMAGE (once; a few minutes) ..."
    "$DOCKER" build ${PLAT_ARGS[@]+"${PLAT_ARGS[@]}"} ${NODE_VERSION:+--build-arg "NODE_VERSION=$NODE_VERSION"} -t "$IMAGE" -f scripts/linux-container/Dockerfile scripts/linux-container
  fi
}

TTY=(); if [ -t 0 ] && [ -t 1 ]; then TTY=(-it); fi
# Only the repository (read-only) and the named volume. The in-container work is scripts/linux-container/inside.sh.
run() {   # run <user> <mode> [docker options before the image]
  local user="$1" mode="$2"; shift 2
  "$DOCKER" run --rm --init ${TTY[@]+"${TTY[@]}"} ${PLAT_ARGS[@]+"${PLAT_ARGS[@]}"} --user "$user" --shm-size=1g \
    -v "$ROOT:/repo:ro" -v "$VOLUME:/work" \
    -e KURAL_ARCH="$ARCH" "$@" "$IMAGE" bash /repo/scripts/linux-container/inside.sh "$mode"
}

case "$MODE" in
  build-image) image force ;;
  test)  image; run 1000:1000 test -e HOME=/home/kural ;;
  build) image; run 0:0 build ;;
  live)  image; run 0:0 live ;;
  shell) image; run 0:0 shell ;;
  clean)
    if [ "$YES" != 1 ]; then
      printf 'Remove the Docker volume %s (the build, node_modules, the .deb)? [y/N] ' "$VOLUME"
      read -r a; case "$a" in y|Y) ;; *) echo "Kept."; exit 0 ;; esac
    fi
    "$DOCKER" volume rm "$VOLUME" 2>&1 || true ;;
esac
